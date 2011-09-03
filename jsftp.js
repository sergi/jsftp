/*
 * @package jsFTP
 * @copyright Copyright(c) 2011 Ajax.org B.V. <info AT ajax DOT org>
 * @author Sergi Mansilla <sergi DOT mansilla AT gmail DOT com>
 * @license https://github.com/sergi/jsFTP/blob/master/LICENSE MIT License
 */

var Net = require("net");
var ftpPasv = require("./lib/ftpPasv");
var S;
try { S = require("streamer"); }
catch (e) { S = require("./support/streamer"); }

var Parser = require('./lib/ftp_parser');

var FTP_PORT = 21;
var RE_PASV = /[-\d]+,[-\d]+,[-\d]+,[-\d]+,([-\d]+),([-\d]+)/;
var RE_RES = /^(\d\d\d)\s(.*)/;
var RE_MULTI = /^(\d\d\d)-/;
var RE_NL_END = /\r\n$/;
var RE_NL = /\r\n/;

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

// This array contains the codes for special commands, such as RETR or STOR,
// which send two responses instead of one. Not a multiline response, but
// literally two.
var SPECIAL_CMDS = [150, 125];

var Ftp = module.exports = function(cfg) {
    this.options = cfg;

    if (cfg.onError)
        this.onError = cfg.onError;

    if (cfg.onTimeout)
        this.onTimeout = cfg.onTimeout;

    if (cfg.onConnect)
        this.onConnect = cfg.onConnect;

    // Generate generic methods from parameter names. They can easily be
    // overriden if we need special behavior. They accept any parameters given,
    // it is the responsability of the user to validate the parameters.
    var self = this;
    this.raw = {};
    COMMANDS.forEach(function(cmd) {
        var lcCmd = cmd.toLowerCase();
        self.raw[lcCmd] = function() {
            var callback;
            var action = lcCmd;

            if (arguments.length) {
                var args = Array.prototype.slice.call(arguments);

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
        var self = this;

        function send() {
            cmd([command, callback]);
            socket.write(command + "\r\n");
        }

        var user = this.options.user;
        var pass = this.options.pass;
        var commandLC = command ? command.toLowerCase() : "";
        var isAuthCmd = /feat.*/.test(commandLC) || /user.*/.test(commandLC) || /pass.*/.test(commandLC);

        if (socket.writable) {
            if (!this.authenticated && !isAuthCmd)
                self.auth(user, pass, send);
            else
                send();
        }
        else {
            console.log("FTP socket is not writable, reopening socket...")
            if (!this.connecting) {
                this.connecting = true;

                var reConnect = function() {
                    self.auth(user, pass, function(err, data) {
                        self.connecting = false;
                        self.connected = true;
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
        // Stream of FTP commands from the client.
        cmds = function(next, stop) {
            cmd = next;
        };

        /**
         * Zips (as in array zipping) commands with responses. This creates
         * a stream that keeps yielding command/response pairs as soon as each pair
         * becomes available.
         */
        tasks = S.zip(self.serverResponse(input), S.append(S.list(null), cmds));
        tasks(self.parse.bind(self), function(err) {
            console.log("Ftp socket closed its doors to the public.", err || "");
            if (err && self.onError)
                self.onError(err);

            self.destroy();
        });
    };

    createStreams();
    this.cmd = cmd;
    this.connected = false;
};

(function() {

    this.addCmdListener = function(listener) {
        if (this.cmdListeners.indexOf(listener) === -1)
            this.cmdListeners.push(listener);
    };

    this._createSocket = function(port, host, firstTask) {
        var self = this;
        this.connecting = true;
        var socket = this.socket = Net.createConnection(port, host);
        socket.setEncoding("utf8");

        socket.setTimeout(TIMEOUT, function() {
            if (this.onTimeout)
                this.onTimeout(new Error("FTP socket timeout"));

            this.destroy();
        }.bind(this));

        socket.on("connect", function() {
            console.log("FTP socket connected");
            firstTask && firstTask();
            self.connected = true;
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
        var self = this;

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

                        // If the response code belongs to one of the 'special'
                        // commands (see above), insert a dummy command to pair
                        // it up properly with its response, and avoid messing
                        // up the zipped streams.
                        if (SPECIAL_CMDS.indexOf(code) > -1)
                            self.cmd(null);

                        next({ code: code, text: line });
                    }
                    else {
                        if (!buffer.length && (multiRes = RE_MULTI.exec(line)))
                            currentCode = parseInt(multiRes[1], 10);

                        buffer.push(line);
                    }

                }, this);

                self.keepAlive();
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
        var ftpResponse = action[0];
        var command     = action[1];

        if (!command)
            return;

        var cmdName, callback;
        if (command) {
            cmdName  = command[0];
            callback = command[1] ? command[1] : null;
        }

        var sanitizedCmd = this._sanitize(cmdName);
        this.cmdListeners.forEach(function(listener) {
            listener(sanitizedCmd, ftpResponse);
        });

        if (callback) {
            // In FTP every response code above 399 means error in some way.
            // Since the RFC is not respected by many servers, we are goiong to
            // overgeneralize and consider every value above 399 as an error.
            var hasFailed = ftpResponse && ftpResponse.code > 399;
            var error = hasFailed ? ftpResponse.text : null;
            callback(error, ftpResponse);
        }
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

        var _cmd = cmd.slice(0, 5).toUpperCase();
        if (_cmd === "PASS ")
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
            this.dataConn.destroy();

        this.features = null;
        this.tasks    = null;
        this.cmds     = null;
        this.connected = false;
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
    this.auth = function(user, pass, callback) {
        if (this.authenticating)
            return;

        if (!user) user = "anonymous";
        if (!pass) pass = "@anonymous";

        var self = this;
        this.authenticating = true;
        this._initialize(function() {
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
                            callback(null, res);
                        }
                        else if (res.code === 332) {
                            self.raw.acct(""); // ACCT not really supported
                        }
                        else {
                            callback(new Error("Login not accepted"));
                        }
                    });
                } else {
                    self.authenticating = false;
                    callback(new Error("Login not accepted"));
                }
            });
        });
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
    this.setPassive = function(mode, callback, onConnect) {
        var self = this;
        this.raw.pasv(function(err, res) {
            if (err || res.code !== 227)
                return callback(res.text);

            var match = RE_PASV.exec(res.text);
            if (!match)
                return callback("PASV: Bad port "); // bad port

            var port = (parseInt(match[1], 10) & 255) * 256 + (parseInt(match[2], 10) & 255);
            this.dataConn = new ftpPasv(self.host, port, mode, callback, onConnect);
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

        var self = this;
        var mode = "A";
        this.raw.type(mode, function(err, res) {
            if (err || (res.code !== 250 && res.code !== 200))
                return callback(res.text);

            self.setPassive(mode, callback);
            self.push("LIST" + (filePath ? " " + filePath : ""));
        });
    };

    /**
     * Downloads a file from FTP server, given a valid Path. It uses the RETR
     * command to retrieve the file.
     */
    this.get = function(filePath, callback) {
        var self = this;
        var mode = "I";
        this.raw.type(mode, function(err, res) {
            if (err || (res.code !== 250 && res.code !== 200)) {
                return callback(res.text);
            }

            self.setPassive(mode, callback);
            self.push("RETR" + (filePath ? " " + filePath : ""));
        });
    };

    this.put = function(filePath, buffer, callback) {
        var self = this;
        var mode = "I";
        this.raw.type(mode, function(err, res) {
            if (err || (res.code !== 250 && res.code !== 200))
                return callback(res.text);

            self.setPassive(mode, callback, function(socket) {
                self.raw.stor(filePath, function(err, res) {
                    if (err)
                        callback(err);

                    socket.end(buffer);
                });
            });
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
     * The constants used in the object are defined in ftp_parser.js
     *
     * @param filePath {String} Path to the file or directory to list
     * @param callback {Function} Function to call with the proper data when
     * the listing is finished.
     */
    this.ls = function(filePath, callback) {
        var self = this;
        this.raw.stat(filePath, function(err, data) {
            // We might be connected to a server that doesn't support the
            // 'STAT' command. We use 'LIST' instead.
            if ((err && data.code === 502) ||
                (self.system && self.system.indexOf("hummingbird") > -1)) {
                self.list(filePath, function(err, data) {
                    entriesToList(err, data)
                });
            }
            else {
                entriesToList(err, data);
            }
        });

        function entriesToList(err, entries) {
            if (err)
                return callback(err, entries);

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
        var raw = this.raw;
        raw.rnfr(from, function(err, res) {
            if (err)
                return callback(err);

            raw.rnto(to, function(err, res) { callback(err, res) });
        });
    }

    this.keepAlive = function() {
        if (this._keepAliveInterval)
            clearInterval(this._keepAliveInterval);

        var self = this;
        this._keepAliveInterval = setInterval(self.raw.noop, IDLE_TIME);
    };

}).call(Ftp.prototype);


