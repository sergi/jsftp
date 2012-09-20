/*
 * @package jsftp
 * @copyright Copyright(c) 2012 Ajax.org B.V. <info@c9.io>
 * @author Sergi Mansilla <sergi.mansilla@gmail.com>
 * @license https://github.com/sergi/jsFTP/blob/master/LICENSE MIT License
 */

var Net = require("net");
var Util = require("util");
var EventEmitter = require("events").EventEmitter;
var Parser = require('./lib/ftpParser');
var S = require("streamer");

var slice = Array.prototype.slice;

var FTP_PORT = 21;
var RE_PASV = /[-\d]+,[-\d]+,[-\d]+,[-\d]+,([-\d]+),([-\d]+)/;
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
    "RNFR", "RNTO", "SITE", "STAT", "STOR", "TYPE", "USER", "PASS", "XRMD",
    // Extended features
    "SYST", "CHMOD", "SIZE"
];

// Queue function that maintains an ordered queue of streams.
var queue = function queue() {
    var next;
    var buffer = slice.call(arguments);

    var stream = function stream($, stop) {
        next = $;
        stream._update();
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

// Enqueues an `element` in the `stream` object, which has to be a reference to
// a queue.
var enqueue = function enqueue(stream, element) {
    stream._update.apply(null, slice.call(arguments, 1));
};

// Codes from 100 to 200 are FTP marks
var isMark = function isMark(code) {
    return code > 100 && code < 200;
};

var Ftp = module.exports = function(cfg) {
    "use strict";

    var Emitter = function() { EventEmitter.call(this); };
    Util.inherits(Emitter, EventEmitter);
    this.emitter = new Emitter();

    this.raw = {};
    this.options = cfg;
    // This variable will be true if the server doesn't support the `stat`
    // command. Since listing a directory or retrieving file properties is
    // quite a common operation, it is more efficient to avoid the round-trip
    // to the server.
    this.useList = false;
    this.pasvCallBuffer = [];

    if (cfg) {
        this.onError = cfg.onError;
        this.onTimeout = cfg.onTimeout;
        this.onConnect = cfg.onConnect;
    }

    var self = this;
    var cmdfn = function(action, callback) {
        // check whether the ftp user is authenticated at the moment of the
        // enqueing. ideally this should happen in the `push` method, just
        // before writing to the socket, but that would be complicated,
        // since we would have to 'unshift' the auth chain into the queue
        // or play the raw auth commands (that is, without enqueuing in
        // order to not mess up the queue order. ideally, that would be
        // built into the queue object. all this explanation to justify a
        // slight slopiness in the code flow.
        var authAndEnqueue = function() {
            var isAuthCmd = /feat|user|pass/.test(action);
            if (!self.authenticated && !isAuthCmd) {
                self.auth(self.options.user, self.options.pass, function() {
                    enqueue(self.cmdQueue, [action, callback]);
                });
            }
            else {
                enqueue(self.cmdQueue, [action, callback]);
            }
        };

        if (self.socket && self.socket.writable) {
            authAndEnqueue();
        }
        else if (!self.connecting) {
            self.authenticated = false;
            self._createSocket(self.port, self.host, function(_socket) {
                createStreams(_socket);
                authAndEnqueue();
            });
        }
    };

    // generate generic methods from parameter names. they can easily be
    // overriden if we need special behavior. they accept any parameters given,
    // it is the responsability of the user to validate the parameters.
    COMMANDS.forEach(function(cmd) {
        cmd = cmd.toLowerCase();
        self.raw[cmd] = function() {
            var callback;
            var completeCmd = cmd;
            if (arguments.length) {
                var args = slice.call(arguments);

                if (typeof args[args.length - 1] === "function")
                    callback = args.pop();

                if (args.length)
                    completeCmd += " " + args.join(" ");
            }
            cmdfn(completeCmd, callback || function(){});
        };
    });

    if (DEBUG_MODE) {
        this.emitter.on("command", this._log);
        this.emitter.on("response", this._log);
        this.emitter.on("connect", this._log);
        this.emitter.on("reconnect", this._log);
        this.emitter.on("disconnect", this._log);
    }

    this.host = cfg.host;
    this.port = cfg.port || FTP_PORT;

    this._createSocket(this.port, this.host);

    // Writes a new command to the server, but before that it pushes the
    // command into `cmds` list. This command will get paired with its response
    // once that one is received
    this.push = function(command, callback) {
        if (!command || typeof command !== "string")
            return;

        this.socket.write(command + "\r\n");
        self.emitter.emit("command", this._sanitize(command));
    };

    var createStreams;
    (createStreams = function(_socket) {
        var cmd;
        // Stream of incoming data from the FTP server.
        var input = function(next, stop) {
            _socket.on("connect", self.onConnect || function(){});
            _socket.on("data", next);
            _socket.on("end", stop);
            _socket.on("error", stop);
            _socket.on("close", stop);
        };

        self.cmdQueue = queue();
        (self.nextCmd = function nextCmd() {
            S.head(self.cmdQueue)(function(obj) {
                cmd(obj, self.nextCmd);
                self.push(obj[0], obj[1] || function(){});
            });
        })();

        // Zips (as in array zipping) commands with responses. This creates
        // a stream that keeps yielding command/response pairs as soon as each pair
        // becomes available.
        var tasks = S.zip(
            S.filter(function(x) {
                    // We ignore FTP marks for now. They don't convey useful
                    // information. A more elegant solution should be found in the
                    // future.
                    return !isMark(x.code);
                },
                self.serverResponse(input)
            ),
            S.append(S.list(null), function(next, stop) {
                // Stream of FTP commands from the client.
                cmd = next;
            })
        );

        tasks(self.parse.bind(self), function(err) {
            self.emitter.emit("disconnect", "disconnect");
        });
    })(this.socket);
};

(function() {
    this.addCmdListener = function(listener, action) {
        this.emitter.on(action || "command", listener);
    };

    this._createSocket = function(port, host, firstTask) {
        if (this.socket && this.socket.destroy)
            this.socket.destroy();

        this.connecting = true;
        this.socket = Net.createConnection(port, host);

        var self = this;
        this.socket.setTimeout(TIMEOUT, function() {
            if (self.onTimeout)
                self.onTimeout(new Error("FTP socket timeout"));

            self.destroy();
        });

        this.socket.on("connect", function() {
            self.connecting = false;
            self.emitter.emit("connect", "connect");
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

                    if (simpleRes) {
                        var code = parseInt(simpleRes[1], 10);

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
     * between the client and the server. The `exp` param contains an array
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
        var command  = action[1];
        var callback = command[1];
        if (callback) {
            if (!ftpResponse) {
                callback(new Error("FTP response not defined"));
            }
            // In FTP every response code above 399 means error in some way.
            // Since the RFC is not respected by many servers, we are going to
            // overgeneralize and consider every value above 399 as an error.
            else if (ftpResponse && ftpResponse.code > 399) {
                var err = new Error(ftpResponse.text || "Unknown FTP error.");
                err.code = ftpResponse.code;
                callback(err);
            }
            else {
                callback(null, ftpResponse);
            }
        }
        this.nextCmd();
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
        if (!cmd)
            return;

        var _cmd = cmd.slice(0, 5);
        if (_cmd === "pass ")
            cmd = _cmd + Array(cmd.length - 5).join("*");

        return cmd;
    };

    this.hasFeat = function(feature) {
        return this.features.indexOf(feature.toLowerCase()) > -1;
    };

    /**
     * Returns an array of features supported by the current FTP server
     *
     * @param {String} Server response for the 'FEAT' command
     * @returns {Array} Array of feature names
     */
    this._parseFeats = function(featResult) {
        var features = featResult.split(RE_NL);
        if (features.length) {
            // Ignore header and footer
            features = features.slice(1, -1).map(function(feature) {
                return /^\s*(\w*)\s*/.exec(feature)[1].trim().toLowerCase();
            });
        }
        return features;
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
    this.pendingRequests = [];
    this.auth = function(user, pass, callback) {
        var self = this;
        this.pendingRequests.push(callback);

        function notifyAll(err, res) {
            var cb;
            while (cb = self.pendingRequests.shift())
                cb(err, res);
        }

        if (this.authenticating)
            return;

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
                            notifyAll(null, res);
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
     * Tells the server to enter passive mode, in which the server returns
     * a data port where we can listen to passive data. The callback is called
     * when the passive socket closes its connection.
     *
     * @param callback {function}: Function to execute when the data socket closes (either by success or by error).
     */
    this.getPassiveSocket = function(callback) {
        var self = this;

        // `_getPassive` retrieves a passive connection and sends its socket to
        // the callback.
        var _getPassive = function _getPassive(callback) {
            var doPasv = function(err, res) {
                if (err || res.code !== 227)
                    return callback(res.text);

                // Executes the next passive call, if there are any.
                var nextPasv = function nextPasv(err) {
                    self.currentPasv = null;
                    if (self.pasvCallBuffer.length) {
                        self.currentPasv = self.pasvCallBuffer.shift();
                        self.currentPasv(callback);
                    }
                };

                var match = RE_PASV.exec(res.text);
                if (!match)
                    return callback("PASV: Bad port");

                var port = (parseInt(match[1], 10) & 255) * 256 + (parseInt(match[2], 10) & 255);
                var socket = Net.createConnection(port, self.host);
                // On each one of the events below we want to move on to the
                // next passive call, if any.
                socket.on("close", nextPasv);

                // Send the passive socket to the callback.
                callback(null, socket);
            };

            self.raw.type("I", function(err, res) {
                enqueue(self.cmdQueue, ["pasv", doPasv]);
            });
        }

        // If there is a passive call happening, we put the requested passive
        // call in the passive call buffer, to be executed later.
        var fn = function() { _getPassive(callback); };
        if (this.currentPasv) {
            this.pasvCallBuffer.push(fn);
        }
        // otherwise, execute right away because there is no passive calls
        // occuring right now.
        else {
            this.currentPasv = fn;
            this.currentPasv(callback);
        }
    };

    /**
     * Lists a folder's contents using a passive connection.
     *
     * @param filePath {String} Remote file/folder path
     */
    this.list = function(filePath, callback) {
        if (arguments.length === 1) {
            callback = arguments[0];
            filePath = "";
        }

        var cmdQueue = this.cmdQueue;
        this.getPassiveSocket(function(err, socket) {
            concatStream(err, socket, callback);
            enqueue(cmdQueue, ["list " + filePath]);
        });
    };

    this.get = function(filePath, callback) {
        var cmdQueue = this.cmdQueue;
        this.getPassiveSocket(function(err, socket) {
            concatStream(err, socket, callback);
            enqueue(cmdQueue, ["retr " + filePath]);
        });
    };

    this.getGetSocket = function(path, callback) {
        var self = this;
        this.getPassiveSocket(function(err, socket) {
            if (err)
                callback(err);
            // Pause the socket to avoid data streaming before there are any
            // listeners to it. We'll let the API consumer resume it.
            if (socket.pause)
                socket.pause();

            callback(err, socket);
            enqueue(self.cmdQueue, ["retr " + path]);
        });
    };

    this.put = function(filepath, buffer, callback) {
        var cmdQueue = this.cmdQueue;
        this.getPassiveSocket(function(err, socket) {
            enqueue(cmdQueue, ["stor " + filepath]);
            setTimeout(function() {
                if (socket && socket.writable) {
                    socket.end(buffer);
                    callback();
                }
                else {
                    console.log("ftp error: couldn't retrieve pasv connection for command 'stor " + filepath + "'.");
                }
            }, 100);
        });
    };

    this.getPutSocket = function(filepath, callback) {
        var self = this;
        this.getPassiveSocket(function(err, socket) {
            enqueue(self.cmdQueue, ["stor " + filepath]);
            setTimeout(function() {
                callback(err, socket);
            }, 100);
        });
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
            if (err)
                return callback(err);

            callback(null,
                (entries.text || entries)
                    .split(/\r\n|\n/)
                    .map(function(entry) {
                        return Parser.entryParser(entry.replace("\n", ""));
                    })
                    // Flatten the array
                    .filter(function(value){ return !!value; })
            );
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
                if ((err && data && (data.code === 502 || data.code === 500)) ||
                    // Not sure if the "hummingbird" system check ^^^ is still
                    // necessary. If they support any standards, the 500 error
                    // should have us covered. Let's leave it for now.
                    (self.system && self.system.indexOf("hummingbird") > -1))
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
            if (err)
                return callback(err);

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

function concat(bufs) {
    var buffer, length = 0, index = 0;

    if (!Array.isArray(bufs))
        bufs = Array.prototype.slice.call(arguments);

    for (var i=0, l=bufs.length; i<l; i++) {
        buffer = bufs[i];
        length += buffer.length;
    }

    buffer = new Buffer(length);

    bufs.forEach(function(buf, i) {
        buf.copy(buffer, index, 0, buf.length);
        index += buf.length;
    });

    return buffer;
}

function concatStream(err, socket, callback) {
    if (err)
        return;

    var pieces = [];
    socket.on("data", function(p) { pieces.push(p); });
    socket.on("end", function() {
        callback(null, concat(pieces));
    });
    socket.on("error", function(e) { callback(e); });
}
