var Net = require("net");
var ftpPasv = require("./ftpPasv");
var S = require("./streamer");

var FTP_PORT = 21;
var RE_PASV = /[-\d]+,[-\d]+,[-\d]+,[-\d]+,([-\d]+),([-\d]+)/;
var RE_RES = /^(\d\d\d)\s(.*)/;
var RE_MULTI = /^(\d\d\d)-/;
var RE_NL_END = /\r\n$/;
var RE_NL = /\r\n/;

var COMMANDS = [
    // Commands without parameters
    "ABOR", "PWD", "CDUP", "NOOP", "QUIT", "PASV", "SYST",
    // Commands with one or more parameters
    "CWD", "DELE", "LIST", "MDTM", "MKD", "MODE", "NLST", "PASS", "RETR", "RMD",
    "RNFR", "RNTO", "SITE", "STAT", "STOR", "TYPE", "USER", "PASS"
];

var Ftp = module.exports = function (cfg) {
    // Generate generic methods from parameter names. They can easily be
    // overriden if we need special behavior. They accept any parameters given,
    // it is the responsability of the user to validate the parameters.
    this.raw = {};

    var self = this;
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

            self.push(cmd, callback);
        };
    });

    // Inizialization of connection and credentials details
    var port = cfg.port || FTP_PORT;
    var host = cfg.host;
    var user = cfg.user;
    var pass = cfg.pass;

    var socket = this.createSocket(port, host);

    var cmd;
    this.push = function(command, callback) {
        cmd([command, callback]);
        socket.write(command + "\r\n");
    };

    // Stream of incoming data.
    var input = function(next, stop) {
        socket.on("data", next);
        socket.on("end", stop);
        socket.on("error", stop);
    };

    function requests(source) {
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
    }

    var cmds = function(next, stop) {
        cmd = next;
    };

    var tasks = S.zip(requests(input), S.append(S.list(null), cmds));

    tasks(this.parse.bind(this), function(){});
};

(function() {

    this.createSocket = function(port, host) {
        this.socket = Net.createConnection(port, host);
        this.socket.setEncoding("utf8");
        return this.socket;
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
            var hasFailed = ftpResponse && ftpResponse.code > 399;
            var err = hasFailed ? ftpResponse.text : null;
            callback(err, ftpResponse);
        }
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


    /*
     * Below this point all the complex/composed actions for FTP.
     */
    this.auth = function(user, pass, callback) {
        var self = this;
        this.raw.user(user, function(err, res) {
            if ([230, 331, 332].indexOf(res.code) > -1) {
                self.raw.pass(pass, function(err, res) {
                    if ([230, 202].indexOf(res.code) > -1)
                        callback(null, res);
                    else if (res.code === 332)
                        self.raw.acct("noaccount");
                    else
                        callback(new Error("Login not accepted"));
                });
            } else {
                callback(new Error("Login not accepted"));
            }
        });
    };

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
     * Downloads a file from FTP server, given a valid Path. It uses the RETR
     * command to retrieve the file. the `get` and `retr` methods are synonymous of
     * this method.
     */
    this.retrBinary = function(filePath, callback) {
        var self = this;
        var mode = "I";
        this.raw.type(mode, function(err, res) {
            if (err || res.code !== 250 || res.code !== 200)
                return callback(res.text);

            self.setPassive(mode, callback, function(socket) {
                self.push("RETR" + (filePath ? " " + filePath : ""));
            });
        });
    };

    this.list = function(filePath, callback) {
        var self = this;
        var mode = "A";
        this.raw.type(mode, function(err, res) {
            if (err || res.code !== 250 || res.code !== 200)
                return callback(res.text);

            self.setPassive(mode, callback);
            self.push("LIST" + (filePath ? " " + filePath : ""));
        });
    };

    this.put = function(filePath, buffer, callback) {
        var self = this;
        var mode = "I";
        this.raw.type(mode, function(err, res) {
            if (err || (res.code !== 250 && res.code !== 200))
                return callback(res.text);

            self.setPassive(mode, callback, function(socket) {
                self.push("STOR " + filePath);
                socket.end(buffer);
            });
        });
    }

}).call(Ftp.prototype);

