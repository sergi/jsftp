var Net = require("net");
var ftpPasv = require("./ftpPasv");
var S = require("./streamer")

var FTP_PORT = 21;

var RE_PASV = /[-\d]+,[-\d]+,[-\d]+,[-\d]+,([-\d]+),([-\d]+)/;
var RE_MULTILINE = /^(\d\d\d)-/;
var RE_RESPONSE = /^(\d\d\d)\s(.*)/;
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

    COMMANDS.forEach(function(cmd) {
        var lcCmd = cmd.toLowerCase();
        if (!this.raw[lcCmd]) {
            var self = this;
            this.raw[lcCmd] = function() {
                var fullCmd = cmd;
                var callback;

                if (arguments.length) {
                    var args = Array.prototype.slice.call(arguments)

                    if (typeof args[args.length - 1] == "function")
                        callback = args.pop();

                    if (args.length)
                        fullCmd += " " + args.join(" ");
                }

                self.push(fullCmd, callback);
            };
        }
    }, this);

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
        socket.on('data', next);
        socket.on('end', stop);
        socket.on("error", stop);
    };

    function requests(source) {
        var NL = "\n";
        var buffer = [];
        var currentCode = 0;

        return function stream(next, stop) {
            source(function(data) {
                var lines = data.replace(RE_NL_END, "").replace(RE_NL, NL).split(NL)

                lines.forEach(function(line) {
                    var simpleRes = RE_RESPONSE.exec(line);
                    var multiRes;

                    if (simpleRes) {
                        var code = parseInt(simpleRes[1]);
                        if (buffer.length) {
                            buffer.push(line);
                            if (currentCode === code) {
                                var _currentCode = currentCode;
                                var _buffer = buffer.join("\n");

                                buffer = [];
                                currentCode = 0;

                                next({
                                    code: _currentCode,
                                    text: _buffer
                                });
                            }
                        }
                        else {
                            next({
                                code: code,
                                text: line
                            });
                        }
                    }
                    else if (!buffer.length && (multiRes = RE_MULTILINE.exec(line))) {
                        currentCode = parseInt(multiRes[1]);
                        buffer.push(line);
                    }
                    else {
                        buffer.push(line);
                    }

                }, this);
            }, stop);
        }
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

        this._log(cmdName, ftpResponse);

        if (callback)
            callback(ftpResponse);
    };

    this._log = function(cmd, response) {
        console.log("\n" + (cmd || ""), response.text);
    };

    /*
     * Below this point all the complex/composed actions for FTP.
     */
    this.auth = function(user, pass, callback) {
        var self = this;
        this.raw.user(user, function(res) {
            if ([230, 331, 332].indexOf(res.code) > -1) {
                self.raw.pass(pass, function(res) {
                    if ([230, 202].indexOf(res.code) > -1)
                        callback(res);
                    else if (res.code === 332)
                        self.raw.acct("noaccount");
                    else
                        callback(new Error("Login not accepted"))
                })
            } else {
                callback(new Error("Login not accepted"));
            }
        });
    };

    this.setPassive = function(mode, callback) {
        this.pasv(function(res) {
            if (res.code !== "227")
                return; // pasv failed

            var match = RE_PASV.exec(res.line);
            if (!match)
                return; // bad port

            var port = (parseInt(match[1]) & 255) * 256 + (parseInt(match[2]) & 255);
            this.dataConn = new ftpPasv(this.host, port, mode, callback);
        });
    };

    /**
     * Downloads a file from FTP server, given a valid Path. It uses the RETR
     * command to retrieve the file. the `get` and `retr` methods are synonymous of
     * this method.
     */
    this.retrBinary = function(filePath, callback) {
        var mode = "I";
        this.type(mode, function(res) {
            if (res.code === "250" || res.code === "200") {
                this.setPassive(mode, callback);
                this.processCmd("RETR" + (filePath ? " " + filePath : ""));
            }
        });
    };

    this.list = function(filePath, callback) {
        var mode = "A";
        this.type(mode, function(typeRes) {
            if (typeRes.code === "250" || typeRes.code === "200") {
                this.setPassive(mode, callback);
                this.processCmd("LIST" + (filePath ? " " + filePath : ""));
            }
        });
    };

}).call(Ftp.prototype)

