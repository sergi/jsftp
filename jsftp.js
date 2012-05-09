/*
 * @package jsftp
 * @copyright Copyright(c) 2012 Ajax.org B.V. <info@c9.io>
 * @author Sergi Mansilla <sergi.mansilla@gmail.com>
 * @license https://github.com/sergi/jsftp/blob/master/LICENSE MIT License
 */

var Net = require("net");
var Util = require("util");
var EventEmitter = require("events").EventEmitter;
var Parser = require("./lib/ftpParser");
var Gab = require("gab");

var slice = Array.prototype.slice;

var FTP_PORT = 21;
var RE_PASV = /[-\d]+,[-\d]+,[-\d]+,[-\d]+,([-\d]+),([-\d]+)/;
var RE_RES = /^(\d{3})\s(.*)/;
var RE_MULTI = /^(\d{3})-/;
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

// From https://github.com/coolaj86/node-bufferjs
var concat = function(bufs) {
    var buffer;
    var length = 0;
    var index = 0;

    if (!Array.isArray(bufs))
        bufs = Array.prototype.slice.call(arguments);

    for (var i=0, l=bufs.length; i<l; i++) {
        buffer = bufs[i];
        length += buffer.length;
    }

    buffer = new Buffer(length);
    bufs.forEach(function (buf, i) {
        buf.copy(buffer, index, 0, buf.length);
        index += buf.length;
    });

    return buffer;
}

// Codes from 100 to 200 are FTP marks
var isMark = function isMark(code) {
    return code > 100 && code < 200;
};

var Ftp = module.exports = function(cfg) {
    Gab.apply(this, arguments);
    var Emitter = function() { EventEmitter.call(this); };
    Util.inherits(Emitter, EventEmitter);
    this.emitter = new Emitter();

    this.raw = {};
    this.data = "";
    this.buffer = [];
    this.options = cfg;
    this.cmdQueue = [["NOOP", function() {}]];
    // This variable will be true if the server doesn't support the `stat`
    // command. Since listing a directory or retrieving file properties is
    // quite a common operation, it is more efficient to avoid the round-trip
    // to the server.
    this.useList = false;
    this.currentCode = 0;

    this.host = cfg.host;
    this.port = cfg.port || FTP_PORT;

    // Generate generic methods from parameter names. They can easily be
    // overriden if we need special behavior. They accept any parameters given,
    // it is the responsability of the user to validate the parameters.
    COMMANDS.forEach(this.generateCommand, this);

    if (DEBUG_MODE) {
        this.emitter.on("command", this._log);
        this.emitter.on("response", this._log);
    }

    this.connect(this.port, this.host);
};

Ftp.prototype = new Gab;
Ftp.prototype.constructor = Ftp;

(function() {
    "use strict";

    this.generateCommand = function(cmd) {
        var self = this;
        cmd = cmd.toLowerCase();
        this.raw[cmd] = function() {
            var callback;
            var args = slice.call(arguments);
            if (typeof args[args.length - 1] === "function") {
                callback = args.pop();
            }

            if (cmd === "quit" && self._keepAliveInterval)
                clearInterval(self._keepAliveInterval);
            else
                self.keepAlive();

            // Check whether the FTP user is authenticated at the moment of the
            // enqueing. Ideally this should happen in the `push` method, just
            // before writing to the socket, but that would be complicated,
            // since we would have to 'unshift' the auth chain into the queue
            // or play the raw auth commands (that is, without enqueuing in
            // order to not mess up the queue order. Ideally, that would be
            // built into the queue object. All this explanation to justify a
            // slight slopiness in the code flow.
            var action = cmd + " " + args.join(" ");
            var isAuthCmd = /feat|user|pass/.test(action);
            if (!self.authenticated && !isAuthCmd) {
                self.auth(self.options.user, self.options.pass, function() {
                    self.push([action.trim(), callback]);
                });
            }
            else {
                self.push([action.trim(), callback]);
            }
        };
    },

    this.collectIncomingData = function(data) {
        // if (isMark(data.code))
            // return;

        this.data += data;
    },

    // Writes a new command to the server, but before that it pushes the
    // command into `cmds` list. This command will get paired with its response
    // once that one is received
    this.push = function(data, onWriteCallback) {
        var command = data[0];
        Gab.prototype.push.call(this, command + "\r\n");

        this.emitter.emit("command", this._sanitize(command));
        this.cmdQueue.push(data);

        if (onWriteCallback) {
            onWriteCallback();
        }
    };

    this.foundTerminator = function() {
        var NL = "\n";
        var line = this.data.replace("\r", "");
        this.data = "";

        var simpleRes = RE_RES.exec(line);
        var multiRes = RE_MULTI.exec(line);
        if (simpleRes) {
            var code = parseInt(simpleRes[1], 10);
            if (this.buffer.length) {
                this.buffer.push(line);

                // Multiline responses from FTP signal last line by
                // starting the last line with the code that they started with.
                if (this.currentCode === code) {
                    line = this.buffer.join(NL);
                    this.buffer = [];
                    this.currentCode = 0;
                }
                else {
                    return;
                }
            }

            var ftpResponse = {
                code: code,
                text: line
            };

            if (this.cmdQueue.length) {
                var cmd = this.cmdQueue.shift();
                var cbk = cmd[1];

                if (!cbk)
                    return;

                this.emitter.emit("response", ftpResponse.text);
                // In FTP every response code above 399 means error in some way.
                // Since the RFC is not respected by many servers, we are going to
                // overgeneralize and consider every value above 399 as an error.
                if (ftpResponse && ftpResponse.code > 399) {
                    var err = new Error(ftpResponse.text || "Unknown FTP error.");
                    err.code = ftpResponse.code;
                    cbk(err);
                }
                else {
                    cbk(null, ftpResponse);
                }
            }
        }
        else {
            if (!this.buffer.length && multiRes)
                this.currentCode = parseInt(multiRes[1], 10);

            this.buffer.push(line);
        }
    },

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
                return (/^\s*(\w*)\s*/).exec(feature)[1].trim().toLowerCase();
            });
        }
        return features;
    };

    this.destroy = function() {
        if (this._keepAliveInterval)
            clearInterval(this._keepAliveInterval);

        this.socket.destroy();

        this.features = null;
        this.tasks = null;
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
                } else {
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
     * @param data {Object} Object with the following properties:
     *
     *  mode {String}, optional: "I" or "A", referring to binary or text format, respectively. Default is binary.
     *  cmd {String}: String of the command to execute,
     *  onCmdWrite {function}, optional: Function to execute just after writing the command to the socket.
     *  pasvCallback {function}, optional: Function to execute when the data socket closes (either by success or by error).
     */
    this.setPassive = function(data) {
        var self = this;
        var callback = data.pasvCallback;

        var doPasv = function(err, res) {
            if (err || res.code !== 227)
                return callback(res.text);

            var match = RE_PASV.exec(res.text);
            if (!match)
                return callback("PASV: Bad port");

            var port = (parseInt(match[1], 10) & 255) * 256 + (parseInt(match[2], 10) & 255);

            var onConnect = function() {
                self.push([data.cmd], function() {
                    if (data.onCmdWrite)
                        data.onCmdWrite(psvSocket);
                });
            };

            var pieces = [];
            var onData = function(result) {
                pieces.push(result);
            };

            var onEnd = function(error) {
                if (error)
                    callback(error);
                else if (data.mode === "I")
                    callback(null, concat(pieces));
                else
                    callback(null, pieces.join("\n"));
            };

            var psvSocket = Net.createConnection(port, self.host);
            if (data.mode !== "I") {
                psvSocket.setEncoding("utf8");
            }

            psvSocket.once("connect", onConnect);
            psvSocket.on("data", onData);
            psvSocket.on("end", onEnd);
            psvSocket.on("error", onEnd);
        };

        // Make sure to set the desired mode before starting any passive
        // operation.
        this.raw.type(data.mode, function(err, res) {
            self.push(["pasv", doPasv]);
        });
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

        this.setPassive({
            cmd: "list " + filePath,
            pasvCallback: callback
        });
    };

    /**
     * Downloads a file from FTP server, given a valid Path. It uses the RETR
     * command to retrieve the file.
     */
    this.get = function(filePath, callback) {
        this.setPassive({
            mode: "I",
            cmd: "retr " + filePath,
            pasvCallback: callback
        });
    };

    this.put = function(filePath, buffer, callback) {
        var self = this;
        this.setPassive({
            mode: "I",
            cmd: "stor " + filePath,
            onCmdWrite: function(socket) {
                if (socket && socket.writable)
                    socket.end(buffer);
            },
            pasvCallback: function(error, contents) {
                // noop function in place because 'STOR' returns an extra command
                // giving the state of the transfer.
                if (!error)
                    self.cmdQueue.push(["NOOP", function() {}])

                callback(error, contents);
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
        var entriesToList = function(err, entries) {
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
                if ((err && (data.code === 502 || data.code === 500)) ||
                    // Not sure if the "hummingbird" system check ^^^ is still
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

