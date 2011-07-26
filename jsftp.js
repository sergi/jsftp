/*
 * @package jsFTP
 * @copyright Copyright(c) 2011 Ajax.org B.V. <info AT ajax DOT org>
 * @author Sergi Mansilla <sergi DOT mansilla AT gmail DOT com>
 * @license https://github.com/sergi/jsFTP/blob/master/LICENSE MIT License
 */

var Net = require("net");
var ftpPasv = require("./lib/ftpPasv");
var S = require("streamer");
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

var Ftp = module.exports = function (cfg) {
    // Generate generic methods from parameter names. They can easily be
    // overriden if we need special behavior. They accept any parameters given,
    // it is the responsability of the user to validate the parameters.
    var self = this;
    this.raw = {};
    COMMANDS.forEach(function(cmd) {
        var lcCmd = cmd.toLowerCase();
        self.raw[lcCmd] = function() {
            var callback;

            if (arguments.length) {
                var args = Array.prototype.slice.call(arguments);

                if (typeof args[args.length - 1] == "function")
                    callback = args.pop();

                if (args.length)
                    cmd += " " + args.join(" ");
            }
            self.keepAlive();

            self.push(cmd, callback);
        };
    });

    this.host = cfg.host;
    this.port = cfg.port || FTP_PORT;

    var socket = this.createSocket(this.port, this.host);
    var cmd;
    /**
     * Writes a new command to the server, but before that it pushes the
     * command into `cmds` list. This command will get paired with its response
     * once that one is received
     */
    this.push = function(command, callback) {
        cmd([command, callback]);
        socket.write(command + "\r\n");
    };

    // Stream of incoming data from the FTP server.
    var input = function(next, stop) {
        socket.on("data", next);
        socket.on("end", stop);
        socket.on("error", stop);
    };

    /**
     * Stream of FTP commands from the client.
     */
    var cmds = function(next, stop) {
        cmd = next;
    };

    /**
     * Zips (as in array zipping) commands with responses. This creates
     * a stream that keeps yielding command/response pairs as soon as each pair
     * becomes available.
     */
    var tasks = S.zip(this.serverResponse(input), S.append(S.list(null), cmds));

    tasks(this.parse.bind(this), function(){});
};

(function() {

    this.createSocket = function(port, host) {
        var socket = this.socket = Net.createConnection(port, host);
        socket.setEncoding("utf8");
        var self = this;
        socket.setTimeout(TIMEOUT, function() {
            self.destroy();
            throw new Error("FTP socket timeout");
        });

        return this.socket;
    };

    /**
     * `requests` receives a stream of responses from the server and filters
     * them before pushing them back into the stream. The filtering is
     * necessary to detect multiline responses, in which several responses from
     * the server belong to a single command.
     */
    this.serverResponse = function requests(source) {
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
        var ftpResponse = action[0];
        var command     = action[1];

        var cmdName, callback;
        if (command) {
            cmdName  = command[0];
            callback = command[1] ? command[1] : null;
        }

        this._log(this._sanitize(cmdName), ftpResponse);

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

            self.keepAlive();

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
        this.user = null;
        this.password = null;
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
        if (!user) user = "anonymous";
        if (!pass) pass = "@anonymous";

        var self = this;
        this._initialize(function() {
            self.raw.user(user, function(err, res) {
                if ([230, 331, 332].indexOf(res.code) > -1) {
                    self.raw.pass(pass, function(err, res) {
                        if ([230, 202].indexOf(res.code) > -1) {
                            callback(null, res);
                        }
                        else if (res.code === 332) {
                            self.raw.acct("noaccount");
                        }
                        else {
                            callback(new Error("Login not accepted"));
                        }
                    });
                } else {
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
        this.raw.pasv(function(err, res) {
            if (err || res.code !== 227)
                return callback(res.text);

            var match = RE_PASV.exec(res.text);
            if (!match)
                return callback("PASV: Bad port "); // bad port

            var port = (parseInt(match[1], 10) & 255) * 256 + (parseInt(match[2], 10) & 255);
            this.dataConn = new ftpPasv(this.host, port, mode, callback, onConnect);
        });
    };

    /**
     * Lists a folder's contents using a passive connection.
     *
     * @param filePath {String} Remote foldder path
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
     * command to retrieve the file. the `get` and `retr` methods are synonymous of
     * this method.
     */
    this.get = function(filePath, callback) {
        var self = this;
        var mode = "I";
        this.raw.type(mode, function(err, res) {
            if (err || (res.code !== 250 && res.code !== 200))
                return callback(res.text);

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
                self.raw.stor(filePath);
                socket.end(buffer);
            });
        });
    };

    this.ls = function(filePath, callback) {
        if (arguments.length === 1) {
            // The user didn't specify any parameters, let's use LIST without
            // parameters, since it defaults to the current dir.
            callback = arguments[0];
            this.list(entriesToList);
        }
        else {
            this.raw.stat(filePath, function(err, data) {
                entriesToList(err, data.text);
            });
        }

        function entriesToList(err, entries) {
            if (err)
                return callback(err);

            callback(null,
                entries.split(RE_NL).map(function(entry) {
                    return Parser.entryParser(entry);
                })
            );
        }
    };

    this.keepAlive = function() {
        if (this._keepAliveInterval)
            clearInterval(this._keepAliveInterval);

        var self = this;
        this._keepAliveInterval = setInterval(self.raw.noop, IDLE_TIME);
    };

}).call(Ftp.prototype);

