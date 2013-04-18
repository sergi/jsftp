/*
 * @package jsftp
 * @copyright Copyright(c) 2012 Ajax.org B.V. <info@c9.io>
 * @author Sergi Mansilla <sergi.mansilla@gmail.com>
 * @license https://github.com/sergi/jsFTP/blob/master/LICENSE MIT License
 */

var Net = require("net");
var EventEmitter = require("events").EventEmitter;
var Parser = require("./ftpParser");
var S = require("streamer");

var slice = Array.prototype.slice;

var FTP_PORT = 21;
var RE_PASV = /([-\d]+,[-\d]+,[-\d]+,[-\d]+),([-\d]+),([-\d]+)/;
var RE_RES = /^(\d\d\d)\s(.*)/;
var RE_MULTI = /^(\d\d\d)-/;
var RE_NL_END = /\r\n$/;
var RE_NL = /\r\n/;

var DEBUG_MODE = false;
var TIMEOUT = 10 * 60 * 1000;
var IDLE_TIME = 30000;
var COMMANDS = [
    // Commands without parameters
    "ABOR", "PWD", "CDUP", "FEAT", "NOOP", "QUIT", "PASV", "SYST",
    // Commands with one or more parameters
    "CWD", "DELE", "LIST", "MDTM", "MKD", "MODE", "NLST", "PASS", "RETR", "RMD",
    "RNFR", "RNTO", "SITE", "STAT", "STOR", "TYPE", "USER", "PASS", "XRMD", "OPTS",
    // Extended features
    "SYST", "CHMOD", "SIZE"
];

var Ftp = module.exports = function(cfg) {
    "use strict";

    // Set up some properties used all around
    this.emitter = new EventEmitter();
    this.raw = {};
    // This variable will be true if the server doesn't support the `stat`
    // command. Since listing a directory or retrieving file properties is
    // quite a common operation, it is more efficient to avoid the round-trip
    // to the server.
    this.useList = false;
    this.pasvCallBuffer = [];
    // This will contain commands sent while the socket was offline or
    // connecting. As soon as the socket is connected and we create streams,
    // they will be sent to the server.
    this.waitingForEnqueue = [];

    for (var option in cfg) {
        if (!this[option]) this[option] = cfg[option];
    }

    this.port = this.port || FTP_PORT;

    COMMANDS.forEach(this._generateCmd.bind(this));

    if (DEBUG_MODE) {
        var self = this;
        ["command", "response", "connect", "reconnect", "disconnect"].forEach(function(event) {
            self.emitter.on(event, console.log);
        });
    }

    this._createSocket(this.port, this.host);
};

// Queue function that maintains an ordered queue of streams.
Ftp.queue = function() {
    var next;
    var buffer = slice.call(arguments);
    var stream = function stream($, stop) {
        next = $;
        stream._update();
        stream.next = $;
    };

    stream._update = function _update() {
        buffer.push.apply(buffer, arguments);
        if (next && buffer.length) {
            if (false !== next(buffer.shift()))
                _update();
            else
                next = null;
        }
    };
    return stream;
};

// Codes from 100 to 200 are FTP marks
Ftp.isMark = function(code) {
    return code > 100 && code < 200;
};

/**
 * Parse raw output of a file listing, trying in to clean up broken listings in
 * the process
 * @param {String} listing Raw file listing coming from a 'list' or 'stat'
 * @returns {Object[]}
 */
Ftp.parseEntry = function(listing) {
    var t, entry, parsedEntry;
    var parsed = [];
    var splitEntries = listing.split(/\r\n|\n/);
    for (var i = 0; i < splitEntries.length; i++) {
        entry = splitEntries[i];

        if (RE_RES.test(entry) || RE_MULTI.test(entry)) {
            continue;
        }

        parsedEntry = Parser.entryParser(entry);
        if (parsedEntry === null) {
            if (splitEntries[i + 1]) {
                t = Parser.entryParser(entry + splitEntries[i + 1]);
                if (t !== null) {
                    splitEntries[i + 1] = entry + splitEntries[i + 1];
                    continue;
                }
            }

            if (splitEntries[i - 1] && parsed.length > 0) {
                t = Parser.entryParser(splitEntries[i - 1] + entry);
                if (t !== null) {
                    parsed[parsed.length - 1] = t
                }
            }
        }
        else {
            parsed.push(parsedEntry)
        }
    }

    return parsed;
};

Ftp.getPasvPort = function(text) {
    var match = RE_PASV.exec(text);
    if (!match) return false;

    // Array containing the passive host and the port number
    return [match[1].replace(/,/g, "."),
        (parseInt(match[2], 10) & 255) * 256 + (parseInt(match[3], 10) & 255)];
};

(function() {
    this._createStreams = function(_socket) {
        var self = this;
        // Stream of incoming data from the FTP server.
        var input = function(next, stop) {
            _socket.on("data", next);
            _socket.on("end", stop);
            _socket.on("close", stop);
        };

        var cmd;
        this.cmdQueue = Ftp.queue();
        (this.nextCmd = function nextCmd() {
            S.head(self.cmdQueue)(function(obj) {
                cmd(obj, self.nextCmd);
                self.push(obj[0]);
            });
        })();

        var parse = this.parse.bind(this);
        // Zips (as in array zipping) commands with responses. This creates
        // a stream that keeps yielding command/response pairs as soon as each pair
        // becomes available.
        var pairStreamer = S.zip(
            self.serverResponse(input),
            // Stream of FTP commands from the client.
            S.append(S.list(null), function(next, stop) { cmd = next; })
        );

        pairStreamer(parse, function(hadError) {
            if (!hadError) {// Error case handled by error event.
                if (self.connected) {
                    self.emitter.emit("disconnect", "Ftp disconnected.");
                    self.onDisconnect && self.onDisconnect();
                }
                self.connected = false;
            }
        });

        if (this.waitingForEnqueue.length > 0) {
            this.cmdQueue._update.apply(null, this.waitingForEnqueue);
            this.waitingForEnqueue = [];
        }
    };

    /**
     * Writes a new command to the server.
     *
     * @param {String} command Command to write in the FTP socket
     * @returns void
     */
    this.push = function(command) {
        if (!command || typeof command !== "string")
            return;

        this.socket.write(command + "\r\n");
        this.emitter.emit("command", this._sanitize(command));
    };

    this.enqueue = function enqueue() {
        var args = slice.call(arguments);
        if (this.connecting || !this.cmdQueue)
            this.waitingForEnqueue = this.waitingForEnqueue.concat(args);
        else
            this.cmdQueue._update.apply(null, args);
    };

    // Generate generic methods from parameter names. they can easily be
    // overriden if we need special behavior. they accept any parameters given,
    // it is the responsability of the user to validate the parameters.
    this._generateCmd = function(cmd) {
        var self = this;
        cmd = cmd.toLowerCase();
        this.raw[cmd] = function() {
            var callback;
            var completeCmd = cmd;
            if (arguments.length) {
                var args = slice.call(arguments);
                if (typeof args[args.length - 1] === "function")
                    callback = args.pop();

                completeCmd += " " + args.join(" ");
            }
            self._enqueueCmd(completeCmd.trim(), callback);
        };
    };

    this._enqueueCmd = function(action, callback) {
        if (!callback) callback = function() {};
        if (this.socket && this.socket.writable) {
            this._authAndEnqueue(action, callback);
        }
        else if (!this.connecting) {
            var self = this;
            this.authenticated = false;
            this._createSocket(this.port, this.host, function(_socket) {
                self._authAndEnqueue(action, callback);
            });
        }
    };
    // check whether the ftp user is authenticated at the moment of the
    // enqueing. ideally this should happen in the `push` method, just
    // before writing to the socket, but that would be complicated,
    // since we would have to 'unshift' the auth chain into the queue
    // or play the raw auth commands (that is, without enqueuing in
    // order to not mess up the queue order. ideally, that would be
    // built into the queue object. all this explanation to justify a
    // slight slopiness in the code flow.
    this._authAndEnqueue = function(action, callback) {
        var isAuthCmd = /feat|user|pass/.test(action);
        if (!this.authenticated && !isAuthCmd) {
            var self = this;
            this.auth(this.user, this.pass, function() {
                self.enqueue([action, callback]);
            });
        }
        else {
            this.enqueue([action, callback]);
        }
    };

    this.addCmdListener = function(listener, action) {
        this.emitter.on(action || "command", listener);
    };

    this._createSocket = function(port, host, firstTask) {
        if (this.socket && this.socket.destroy)
            this.socket.destroy();

        this.connecting = true;
        this.socket = Net.createConnection(port, host);

        var self = this;
        this.socket.setTimeout(this.timeout || TIMEOUT, function() {
            if (self.onTimeout)
                self.onTimeout(new Error("FTP socket timeout"));

            self.destroy();
        });

        this.socket.on("error", function(err) {
            var errString = "Error on ftp socket: " + err;

            if (self.connected) {
                self.emitter.emit("disconnect", errString);
                self.onDisconnect && self.onDisconnect(err);
            }
            self.connected = false;

            if (self.onError)
                self.onError(err);

            // We still want the error to appearin the logs if we are not in debug mode.
            if (!DEBUG_MODE)
                console.error(errString);
        });

        this.socket.on("connect", function() {
            self.connecting = false;
            self.connected = true;

            self.emitter.emit("connect", "connect");

            if (self.onConnect)
                self.onConnect(self.socket);

            self._createStreams(self.socket);

            if (firstTask) {
                firstTask(self.socket);
            }
        });
    };

    /**
     * `serverResponse` receives a stream of responses from the server and filters
     * them before pushing them back into the stream. The filtering is
     * necessary to detect multiline responses, in which several responses from
     * the server belong to a single command.
     */
    this.serverResponse = function(source) {
        var self = this;
        var NL = "\n";
        var buffer = [];
        var currentCode = 0;

        return function stream(next, stop) {
            source(function(data) {
                var lines = data.toString().replace(RE_NL_END, "").replace(RE_NL, NL).split(NL);

                lines.forEach(function(line) {
                    var simpleRes = RE_RES.exec(line);
                    var multiRes;

                    var code;
                    if (simpleRes) {
                        code = parseInt(simpleRes[1], 10);

                        if (buffer.length) {
                            buffer.push(line);

                            if (currentCode === code) {
                                line = buffer.join(NL);
                                buffer = [];
                                currentCode = 0;
                            }
                        }

                        self.emitter.emit("response", line);
                        next({ code: code, text: line });
                    }
                    else {
                        if (!buffer.length && (multiRes = RE_MULTI.exec(line))) {
                            currentCode = parseInt(multiRes[1], 10);
                        }
                        else if (buffer.length) {
                            // It could happen that the end-of-multiline indicator
                            // line has been truncated. We check the current line against
                            // the previous line to check this case.
                            var str = buffer[buffer.length - 1] + line;
                            var re = RE_RES.exec(str);
                            if (re && parseInt(re[1], 10) === currentCode) {
                                buffer[buffer.length - 1] = str;
                                line = buffer.join(NL);
                                buffer = [];
                                currentCode = 0;

                                self.emitter.emit("response", line);
                                return next({ code: code, text: line });
                            }
                        }
                        buffer.push(line);
                    }
                }, this);
            }, stop);
        };
    };

    /**
     * Parse is called each time that a comand and a request are paired
     * together. That is, each time that there is a round trip of actions
     * between the client and the server. The `action` param contains an array
     * with the response from the server as a first element (text) and an array
     * with the command executed and the callback (if any) as the second
     * element.
     *
     * @param action {Array} Contains server response and client command info.
     */
    this.parse = function(action) {
        if (!action || !action[1])
            return;

        var ftpResponse = action[0];
        var command = action[1];
        var callback = command[1];
        if (ftpResponse != null && Ftp.isMark(ftpResponse.code)) {
            if (callback != null && callback.acceptsMarks) {
                callback(null, ftpResponse);
            }
            this.cmdQueue.next(['', callback]);
        } else {
            if (callback) {
                if (!ftpResponse) {
                    callback(new Error("FTP response not defined"));
                }
                // In FTP every response code above 399 means error in some way.
                // Since the RFC is not respected by many servers, we are going to
                // overgeneralize and consider every value above 399 as an error.
                else if (ftpResponse.code > 399) {
                    var err = new Error(ftpResponse.text || "Unknown FTP error.");
                    err.code = ftpResponse.code;
                    callback(err);
                }
                else {
                    callback(null, ftpResponse);
                }
            }
            this.nextCmd();
        }
    };

    this._initialize = function(callback) {
        var self = this;
        this.raw.feat(function(err, response) {
            self.features = err ? [] : self._parseFeats(response.text);
            callback();
        });
    };

    this._log = function(msg) {
        console.log("\n" + msg);
    };

    /**
     * Cleans up commands with potentially insecure data in them, such as
     * passwords, personal info, etc.
     *
     * @param cmd {String} Command to be sanitized
     * @returns {String} Sanitized command
     */
    this._sanitize = function(cmd) {
        if (!cmd) return "";

        var _cmd = cmd.slice(0, 5);
        if (_cmd === "pass ")
            cmd = _cmd + Array(cmd.length - 5).join("*");

        return cmd;
    };

    /**
     * Returns true if the current server has the requested feature. False otherwise.
     *
     * @param {String} feature Feature to look for
     * @returns {Boolean} Whether the current server has the feature
     */
    this.hasFeat = function(feature) {
        return this.features.indexOf(feature.toLowerCase()) > -1;
    };

    /**
     * Returns an array of features supported by the current FTP server
     *
     * @param {String} features Server response for the 'FEAT' command
     * @returns {String[]} Array of feature names
     */
    this._parseFeats = function(features) {
        // Ignore header and footer
        return features.split(RE_NL).slice(1, -1).map(function(feat) {
            return (/^\s*(\w*)\s*/).exec(feat)[1].trim().toLowerCase();
        });
    };

    this.destroy = function() {
        if (this._keepAliveInterval)
            clearInterval(this._keepAliveInterval);

        this.socket.destroy();

        this.features = null;
        this.authenticated = false;
        this.currentPasv = null;
        this.pasvCallBuffer = [];
    };

    // Below this point all the methods are action helpers for FTP that compose
    // several actions in one command

    /**
     * Authenticates the user.
     *
     * @param user {String} Username
     * @param pass {String} Password
     * @param callback {Function} Follow-up function.
     */
    this.pending = []; // Pending requests
    this.auth = function(user, pass, callback) {
        var self = this;
        this.pending.push(callback);

        function notifyAll(err, res) {
            var cb;
            while (cb = self.pending.shift())
                cb(err, res);
        }

        if (this.authenticating) return;

        if (!user) user = "anonymous";
        if (!pass) pass = "@anonymous";

        this.authenticating = true;
        this._initialize(function() {
            self.raw.user(user, function(err, res) {
                if (!err && [230, 331, 332].indexOf(res.code) > -1) {
                    self.raw.pass(pass, function(err, res) {
                        self.authenticating = false;

                        if (!err && [230, 202].indexOf(res.code) > -1) {
                            self.authenticated = true;
                            self.user = user;
                            self.pass = pass;

                            self.raw.syst(function(err, res) {
                                if (!err && res.code === 215)
                                    self.system = res.text.toLowerCase();
                            });
                            self.raw.type("I", function() {
                                notifyAll(null, res);
                            });
                        }
                        else if (!err && res.code === 332) {
                            self.raw.acct(""); // ACCT not really supported
                        }
                        else {
                            notifyAll(new Error("Login not accepted"));
                        }
                    });
                }
                else {
                    self.authenticating = false;
                    notifyAll(new Error("Login not accepted"));
                }
            });
        });
    };

    /**
     * Lists a folder's contents using a passive connection.
     *
     * @param {String} filePath Remote file/folder path
     * @param {Function} callback Function to call with results
     */
    this.list = function(filePath, callback) {
        if (arguments.length === 1) {
            callback = arguments[0];
            filePath = "";
        }

        this.orderedPasv({
            cmd: "list " + filePath,
            concat: true
        }, callback);
    };

    this.get = function(filePath, callback) {
        this.orderedPasv({
            cmd: "retr " + filePath,
            concat: true
        }, callback);
    };

    /**
     * Returns a socket for a get (RETR) on a path. The socket is ready to be
     * streamed, but it is returned in a paused state. Itis left to the user to
     * resume it.
     *
     * @param path {String} Path to the file to be retrieved
     * @param callback {Function} Function to call when finalized, with the socket as a parameter
     */
    this.getGetSocket = function(path, callback) {
        var self = this;
        this.getPasvSocket(function(err, socket) {
            if (err) return callback(err);

            socket.pause();

            var called = false;

            var cmdCallback = function(err, res) {
                if (!called) {
                    called = true;
                    callback(err, socket);
                }
            };
            cmdCallback.acceptsMarks = true;

            self._enqueueCmd("retr " + path, cmdCallback);
        });
    };

    this.put = function(filePath, buffer, callback) {
        this.orderedPasv({ cmd: "stor " + filePath }, function(err, socket) {
            if (err) return callback(err);

            setTimeout(function() {
                if (socket && socket.writable) {
                    socket.end(buffer);
                    callback(null, buffer);
                }
                else {
                    console.log("ftp error: couldn't retrieve connection for 'stor " + filePath + "'.");
                }
            }, 100);
        });
    };

    this.getPutSocket = function(path, callback, doneCallback) {
        var self = this;
        this.getPasvSocket(function(err, socket) {
            if (err) return callback(err);

            var called = false;

            var cmdCallback = function(err, res) {
                if (!called) {
                    called = true;
                    callback(err, socket);
                } else {
                    if (doneCallback) {
                        if (err) {
                            doneCallback(err)
                        } else {
                            doneCallback(err, res)
                        }
                    }
                }
            };
            cmdCallback.acceptsMarks = true;

            self._enqueueCmd("stor " + path, cmdCallback);
        });
    };

    this.getPasvSocket = function(callback) {
        var self = this;
        var doPasv = function(err, res) {
            if (err || !res || res.code !== 227) {
                if (res && res.text)
                    return callback(new Error(res.text));
                else if (err)
                    return callback(err);
                else
                    return callback(new Error("Unknown error when trying to get into PASV mode"));
            }

            var pasvRes = Ftp.getPasvPort(res.text);
            if (pasvRes === false)
                return callback(new Error("PASV: Bad host/port combination"));

            var host = pasvRes[0];
            var port = pasvRes[1];
            var socket = Net.createConnection(port, host);
            socket.setTimeout(self.timeout || TIMEOUT);
            callback(null, socket);
        };
        self._enqueueCmd("pasv", doPasv);
    };

    /**
     * Sequential passive mode. When this function is used on a command, it will
     * wait until the current command is executed, and then it will proceed to
     * execute the next command in the queue.
     *
     * The options object contains two options:
     *  - options.cmd: is an array containing the command string e.g. ["stor " + filePath]
     *  - options.concat: Whether the result of the operation should be concatenated
     * and delivered to the allback when finished.
     *
     * @param options {Object}: Contains the options for this function
     * @param callback {Function}: Function to execute when the data socket closes (either by success or by error).
     */
    this.orderedPasv = function(options, callback) {
        var self = this;
        // If there is a passive call happening, we put the requested passive
        // call in the passive call buffer, to be executed later.
        var fn = function() {
            this.getPasvSocket(function(err, socket) {
                if (err) return callback(err);

                // Executes the next passive call, if there are any.
                var nextPasv = function nextPasv(err) {
                    self.currentPasv = null;
                    if (self.pasvCallBuffer.length) {
                        self.currentPasv = self.pasvCallBuffer.shift();
                        self.currentPasv(callback);
                    }
                };

                // On each one of the events below we want to move on to the
                // next passive call, if any.
                socket.on("close", nextPasv);
                if (options.concat)
                    Ftp._concatStream(err, socket, callback);
                else
                    callback(err, socket);

                self._enqueueCmd(options.cmd);
            });
        };

        if (this.currentPasv) {
            this.pasvCallBuffer.push(fn);
        }
        // otherwise, execute right away because there are no passive calls
        // happening right now.
        else {
            this.currentPasv = fn;
            this.currentPasv();
        }
    };

    /**
     * Provides information about files. It lists a directory contents or
     * a single file and yields an array of file objects. The file objects
     * contain several properties. The main difference between this method and
     * 'list' or 'stat' is that it returns objects with the file properties
     * already parsed.
     *
     * Example of file object:
     *
     *  {
     *      name: 'README.txt',
     *      type: 0,
     *      time: 996052680000,
     *      size: '2582',
     *      owner: 'sergi',
     *      group: 'staff',
     *      userPermissions: { read: true, write: true, exec: false },
     *      groupPermissions: { read: true, write: false, exec: false },
     *      otherPermissions: { read: true, write: false, exec: false }
     *  }
     *
     * The constants used in the object are defined in ftpParser.js
     *
     * @param filePath {String} Path to the file or directory to list
     * @param callback {Function} Function to call with the proper data when
     * the listing is finished.
     */
    this.ls = function(filePath, callback) {
        var entriesToList = function(err, entries) {
            if (err) return callback(err);

            if (entries instanceof Buffer)
                entries = entries.toString();

            callback(null, Ftp.parseEntry(entries.text || entries));
        };

        if (this.useList) {
            this.list(filePath, entriesToList);
        }
        else {
            var self = this;
            this.raw.stat(filePath, function(err, data) {
                // We might be connected to a server that doesn't support the
                // 'STAT' command, which is set as default. We use 'LIST' instead,
                // and we set the variable `useList` to true, to avoid extra round
                // trips to the server to check.
                if ((err && (err.code === 502 || err.code === 500)) ||
                    (self.system && self.system.indexOf("hummingbird") > -1))
                // Not sure if the "hummingbird" system check ^^^ is still
                // necessary. If they support any standards, the 500 error
                // should have us covered. Let's leave it for now.
                {
                    self.useList = true;
                    self.list(filePath, entriesToList);
                }
                else {
                    entriesToList(err, data);
                }
            });
        }
    };

    this.rename = function(from, to, callback) {
        var self = this;
        self.raw.rnfr(from, function(err, res) {
            if (err) return callback(err);
            self.raw.rnto(to, function(err, res) { callback(err, res); });
        });
    };

    this.keepAlive = function() {
        var self = this;
        if (this._keepAliveInterval)
            clearInterval(this._keepAliveInterval);

        this._keepAliveInterval = setInterval(self.raw.noop, IDLE_TIME);
    };
}).call(Ftp.prototype);

Ftp._concat = function(bufs) {
    var buffer, length = 0, index = 0;

    if (!Array.isArray(bufs))
        bufs = Array.prototype.slice.call(arguments);

    for (var i = 0, l = bufs.length; i < l; i++) {
        buffer = bufs[i];
        length += buffer.length;
    }

    buffer = new Buffer(length);

    bufs.forEach(function(buf) {
        buf.copy(buffer, index, 0, buf.length);
        index += buf.length;
    });

    return buffer;
};

Ftp._concatStream = function(err, socket, callback) {
    if (err) return callback(err);

    var pieces = [];
    socket.on("data", function(p) { pieces.push(p); });
    socket.on("close", function(hadError) {
        if (hadError)
            return callback(new Error("Socket connection error"));

        callback(null, Ftp._concat(pieces));
    });
    socket.resume();
};
