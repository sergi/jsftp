/*
 * @package jsFTP
 * @copyright Copyright(c) 2011 Ajax.org B.V. <info AT ajax DOT org>
 * @author Sergi Mansilla <sergi DOT mansilla AT gmail DOT com>
 * @license https://github.com/sergi/jsFTP/blob/master/LICENSE MIT License
 */

var S;
var Net = require("net");
var ftpPasv = require("./lib/ftpPasv");
var Parser = require('./lib/ftpParser');

try { S = require("streamer"); }
catch (e) { S = require("./support/streamer/core"); }

var slice = Array.prototype.slice;

var FTP_PORT = 21;
var RE_PASV = /[-\d]+,[-\d]+,[-\d]+,[-\d]+,([-\d]+),([-\d]+)/;
var RE_RES = /^(\d\d\d)\s(.*)/;
var RE_MULTI = /^(\d\d\d)-/;
var RE_NL_END = /\r\n$/;
var RE_NL = /\r\n/;

var DEBUG_MODE = false;
var TIMEOUT = 60000;
var IDLE_TIME = 30000;
var COMMANDS = [
    // Commands without parameters
    "ABOR", "PWD", "CDUP", "FEAT", "NOOP", "QUIT", "PASV", "SYST",
    // Commands with one or more parameters
    "CWD", "DELE", "LIST", "MDTM", "MKD", "MODE", "NLST", "PASS", "RETR", "RMD",
    "RNFR", "RNTO", "SITE", "STAT", "STOR", "TYPE", "USER", "PASS",
    // Extended features
    "SYST", "CHMOD", "SIZE"
];

function queue() {
    var next;
    var buffer = slice.call(arguments);

    function stream($, stop) {
        next = $;
        stream._update();
    }

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
}

function enqueue(stream, element) {
   stream._update.apply(null, slice.call(arguments, 1));
}

// Codes from 100 to 200 are FTP marks
function isMark(code) {
    return code > 100 && code < 200;
};

var Ftp = module.exports = function(cfg) {
    this.raw = {};
    this.options = cfg;
    // This variable will be true if the server doesn't support the `stat`
    // command. Since listing a directory or retrieving file properties is
    // quite a common operation, it is more efficient to avoid the round-trip
    // to the server.
    this.useList = false;

    if (cfg) {
        this.onError = cfg.onError;
        this.onTimeout = cfg.onTimeout;
        this.onConnect = cfg.onConnect;
    }

    // Generate generic methods from parameter names. They can easily be
    // overriden if we need special behavior. They accept any parameters given,
    // it is the responsability of the user to validate the parameters.
    var self = this;
    COMMANDS.forEach(function(cmd) {
        var lcCmd = cmd.toLowerCase();
        self.raw[lcCmd] = function() {
            var callback;
            var action = lcCmd;

            if (arguments.length) {
                var args = slice.call(arguments);

                if (typeof args[args.length - 1] == "function")
                    callback = args.pop();

                if (args.length)
                    action += " " + args.join(" ");
            }

            self.keepAlive();
            self.push(action, callback);
        };
    });

    this.cmdListeners = [];

    if (DEBUG_MODE)
        this.addCmdListener(this._log);

    this.host = cfg.host;
    this.port = cfg.port || FTP_PORT;

    var socket = this._createSocket(this.port, this.host);
    var cmd;
    /**
     * Writes a new command to the server, but before that it pushes the
     * command into `cmds` list. This command will get paired with its response
     * once that one is received
     */
    this.push = function(command, callback) {
        if (!command || typeof command != "string")
            return;

        var self = this;
        function send() {
            enqueue(self.cmdQueue, [command, callback]);
            socket.write(command + "\r\n");
        }

        var user = this.options.user;
        var pass = this.options.pass;
        var isAuthCmd = /feat.*/.test(command) || /user.*/.test(command) || /pass.*/.test(command);

        if (socket.writable) {
            if ((this.authenticating || !this.authenticated) && !isAuthCmd) {
                self.auth(user, pass, send);
            }
            else {
                send();
            }
        }
        else {
            if (DEBUG_MODE)
                console.log("FTP socket is not writable, reopening socket...");

            if (!this.connecting) {
                this.connecting = true;

                var reConnect = function() {
                    self.auth(user, pass, function(err, data) {
                        self.connecting = false;
                        if (!err && !isAuthCmd)
                            send();
                    });
                };

                try {
                    socket = this._createSocket(this.port, this.host, reConnect);
                    createStreams();
                }
                catch (e) {
                    console.log(e);
                }
            }
        }
    };

    // Stream of incoming data from the FTP server.
    var input = function(next, stop) {
        socket.on("connect", self.onConnect || function(){});
        socket.on("data", next);
        socket.on("end", stop);
        socket.on("error", stop);
        socket.on("close", stop);
    };

    var cmds, tasks;
    var createStreams = function() {
        self.cmdQueue = queue();
        (self.nextCmd = function nextCmd() {
            S.head(self.cmdQueue)(function(obj) {
                cmd(obj, self.nextCmd);
            });
        })();

        self.pasvQueue = queue();
        (self.nextPasv = function nextPasv() {
            // Take first element from `pasvQueue` and process it via `processElement` black box that will call
            // `recur` once it's done to process next element from the `pasvQueue` queue.
            S.head(self.pasvQueue)(function(element) {
                self.processPasv(element, self.nextPasv);
            });
        })();

        // Stream of FTP commands from the client.
        cmds = function(next, stop) {
            cmd = next;
        };

        /**
         * Zips (as in array zipping) commands with responses. This creates
         * a stream that keeps yielding command/response pairs as soon as each pair
         * becomes available.
         */
        tasks = S.zip(S.filter(function(x) {
            // We ignore FTP marks for now. They don't convey useful
            // information. A more elegant solution should be found in the
            // future.
            var mark = isMark(x.code);
            /*
            if (mark) {
                self.cmdListeners.forEach(function(listener) {
                    listener(null, x);
                });
            }
            */
            return !mark;
        }, self.serverResponse(input)), S.append(S.list(null), cmds));

        tasks(self.parse.bind(self), function(err) {
            if (DEBUG_MODE)
                console.log("Ftp socket closed its doors to the public.", err || "");
            if (err && self.onError)
                self.onError(err);

            self.destroy();
        });
    };

    createStreams();
    this.cmd = cmd;
};

(function() {

    this.addCmdListener = function(listener) {
        if (this.cmdListeners.indexOf(listener) === -1)
            this.cmdListeners.push(listener);
    };

    this._createSocket = function(port, host, firstTask) {
        this.connecting = true;
        var socket = this.socket = Net.createConnection(port, host);
        socket.setEncoding("utf8");

        socket.setTimeout(TIMEOUT, function() {
            if (this.onTimeout)
                this.onTimeout(new Error("FTP socket timeout"));

            this.destroy();
        }.bind(this));

        var self = this;
        socket.on("connect", function() {
            if (DEBUG_MODE) console.log("FTP socket connected");
            firstTask && firstTask();
            self.connecting = false;
        });

        return this.socket;
    };

    /**
     * `serverResponse` receives a stream of responses from the server and filters
     * them before pushing them back into the stream. The filtering is
     * necessary to detect multiline responses, in which several responses from
     * the server belong to a single command.
     */
    this.serverResponse = function(source) {
        var NL = "\n";
        var buffer = [];
        var currentCode = 0;

        return function stream(next, stop) {
            source(function(data) {
                var lines = data.replace(RE_NL_END, "").replace(RE_NL, NL).split(NL);

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

                        next({ code: code, text: line });
                    }
                    else {
                        if (!buffer.length && (multiRes = RE_MULTI.exec(line)))
                            currentCode = parseInt(multiRes[1], 10);

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

        var self = this;
        var ftpResponse = action[0];
        var command  = action[1];
        var callback = command[1];

        self.cmdListeners.forEach(function(listener) {
            listener(self._sanitize(command[0]), ftpResponse);
        });

        if (callback) {
            // In FTP every response code above 399 means error in some way.
            // Since the RFC is not respected by many servers, we are goiong to
            // overgeneralize and consider every value above 399 as an error.
            var hasFailed = ftpResponse && ftpResponse.code > 399;
            callback(hasFailed && (ftpResponse.text || "Unknown FTP error."), ftpResponse);
        }
        this.nextCmd();
    };

    this._initialize = function(callback) {
        var self = this;
        this.raw.feat(function(err, response) {
            if (err)
                self.features = [];
            else
                self.features = self._parseFeats(response.text);

            callback();
        });
    };

    this._log = function(cmd, response) {
        console.log("\n" + (cmd || "") + "\n" + response.text);
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
        feature = feature.toLowerCase();
        return this.features && (this.features.indexOf(feature) > -1);
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

        if (this.dataConn)
            this.dataConn.socket.destroy();

        this.features = null;
        this.tasks    = null;
        this.authenticated = false;
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
        //this._initialize(function() {
            self.raw.user(user, function(err, res) {
                if ([230, 331, 332].indexOf(res.code) > -1) {
                    self.raw.pass(pass, function(err, res) {
                        self.authenticating = false;

                        if ([230, 202].indexOf(res.code) > -1) {
                            self.authenticated = true;
                            self.user = user;
                            self.pass = pass;

                            self.raw.syst(function(err, res) {
                                if (!err && res.code === 215)
                                    self.system = res.text.toLowerCase();
                            });
                            notifyAll(null, res);
                        }
                        else if (res.code === 332) {
                            self.raw.acct(""); // ACCT not really supported
                        }
                        else {
                            notifyAll(new Error("Login not accepted"));
                        }
                    });
                } else {
                    self.authenticating = false;
                    notifyAll(new Error("Login not accepted"));
                }
            });
        //});
    };

    /**
     * Tells the server to enter passive mode, in which the server returns
     * a data port where we can listen to passive data. The callback is called
     * when the passive socket closes its connection.
     *
     * @param mode {String} String that specifies binary or non-binary mode ("I or "A")
     * @param callback {Function} Function to call when socket has received all the data
     * @param onConnect {Function} Function to call when the passive socket connects
     */
    this.setPassive = function(data) {
        enqueue(this.pasvQueue, data);
    };

    this.processPasv = function(data, next) {
        var callback = function(err, res) {
            data.callback && data.callback(err, res);
            next();
        };

        var self = this;
        var doPasv = function doPasv() {
            self.raw.pasv(function(err, res) {
                if (err || res.code !== 227)
                    return callback(res.text);

                var match = RE_PASV.exec(res.text);
                if (!match)
                    return callback("PASV: Bad port");

                var port = (parseInt(match[1], 10) & 255) * 256 + (parseInt(match[2], 10) & 255);
                self.dataConn = new ftpPasv({
                    host: self.host,
                    port: port,
                    mode: data.mode,
                    callback: callback,
                    onConnect: data.onConnect,
                    ftp: self
                });
            });
        };

        if (this.dataConn && this.dataConn.writable) {
            this.dataConn.on("close", doPasv);
            this.dataConn.end();
        }
        else {
            doPasv();
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

        var self = this
        this.setPassive({
            callback: callback,
            onConnect: function(socket) {
                self.raw.list(filePath);
            }
        });
    };

    /**
     * Downloads a file from FTP server, given a valid Path. It uses the RETR
     * command to retrieve the file.
     */
    this.get = function(filePath, callback) {
        var self = this;
        self.setPassive({
            mode: "I",
            callback: callback,
            onConnect: function(socket) {
                self.raw.retr(filePath);
            }
        });
    };

    this.put = function(filePath, buffer, callback) {
        var self = this;
        this.setPassive({
            mode: "I",
            callback: callback,
            onConnect: function(socket) {
                self.raw.stor(filePath, function(err, res) {
                    if (err)
                        callback(err);
                });

                // This would actually work without the setTimeout because FTP
                // actually buffers anything written in the socket before doing
                // the STOR. But we won't go around trusting other FTP servers.
                setTimeout(function() {
                    socket.writable && socket.end(buffer);
                }, 100);
            }
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
                if ((err && (data.code === 502 || data.code === 500)) ||
                    // Not sure if the "hummingbird" system check ^^^ his still
                    // necessary. If they support any standards, the 500 error
                    // should have us covered. Let's leave it for now.
                    (self.system && self.system.indexOf("hummingbird") > -1)) {
                    self.useList = true;
                    self.list(filePath, entriesToList);
                }
                else {
                    entriesToList(err, data);
                }
            });
        }

        function entriesToList(err, entries) {
            if (err)
                return callback(err, entries);

            if (!entries)
                return callback(null, []);

            callback(null,
                (entries.text || entries)
                    .split(/\r\n|\n/)
                    .map(function(entry) {
                        return Parser.entryParser(entry.replace("\n", ""));
                    })
                    // Flatten the array
                    .filter(function(value){ return !!value; })
            );
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

