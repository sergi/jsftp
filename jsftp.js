var Net = require("net");
var Gab = require("./support/gab/gab");
var ftpPasv = require("./ftpPasv");

var FTP_PORT = 21;

var RE_PASV = /[-\d]+,[-\d]+,[-\d]+,[-\d]+,([-\d]+),([-\d]+)/;
var RE_MULTILINE = /(\d\d\d)-/;
var RE_RESPONSE = /^(\d\d\d)\s(.*)/;

var COMMANDS = [
    // Commands without parameters
    "ABOR", "PWD", "CDUP", "NOOP", "QUIT", "PASV", "SYST",
    // Commands with one or more parameters
    "CWD", "DELE", "LIST", "MDTM", "MKD", "MODE", "NLST", "PASS", "RETR", "RMD",
    "RNFR", "RNTO", "SITE", "STAT", "STOR", "TYPE", "USER"
];

var Ftp = module.exports = function (cfg) {
    Gab.apply(this, arguments);

    // Generate generic methods from parameter names. They can easily be
    // overriden if we need special behavior. They accept any parameters given,
    // it is the responsability of the user to validate the parameters.
    var self = this;
    COMMANDS.forEach(function(cmd) {
        var lcCmd = cmd.toLowerCase();
        if (!self[lcCmd]) {
            self[lcCmd] = function() {
                var fullCmd = cmd;
                if (arguments.length) {
                    var callback;
                    var args = Array.prototype.slice.call(arguments)

                    if (typeof args[args.length - 1] == "function")
                        callback = args.pop();

                    fullCmd += " " + args.join(" ");

                    if (callback)
                        this.customResponse[cmd] = callback;
                }

                self.processCmd(fullCmd);

                return self;
            };
        }
    });

    // Inizialization of connection and credentials details
    var port = this.port = cfg.port || FTP_PORT;
    var host = this.host = cfg.host;
    var user = this.user = cfg.user;
    var pass = this.pass = cfg.pass;

    // The `data variable collects the raw incoming data coming from the server
    this.data = "";
    this.commands = [];
    this.response = [];
    this.customResponse = {};
    // This variable is set to the current response code when we are in
    // a multiline response. The value `0` means that we are not in a multiline
    // response
    this.inMultiline = 0;
    // Standard FTP EOF terminator
    this.setTerminator("\r\n");
    this.setEncoding("utf8");

    // The first time we connect to the FTP server we run the `USER` command
    // and set the (post-connect) handler to `ftpHandleConnect`.
    this.handler = this.ftpHandleConnect;
    this.processCmd("USER " + this.user);

    this.connect(port, host);
};

Ftp.prototype = new Gab;
Ftp.prototype.constructor = Ftp;

Ftp.handleResponse = {
    "USER": function(res) {
        if (res.code === "230") {
            return; // user accepted
        }
        else if (res.code === "331" || res.code === "332") {
            this.push("PASS " + this.pass + "\r\n");
            this.handler = Ftp.handleResponse.PASS;
        }
        else {
            throw new Error("ftp login failed: user name not accepted");
        }
    },
    "PASS": function(res) {
        if (res.code === "230") {
            return; // user and password accepted
        }
        else {
            throw new Error("ftp login failed: password not accepted");
        }
    },
    "PASV": function(res) {
        if (res.code !== "227")
            return; // pasv failed

        var match = RE_PASV.exec(res.line);
        if (!match)
            return; // bad port

        var port = (parseInt(match[1]) & 255) * 256 + (parseInt(match[2]) & 255);
        // establish data connection
        this.dataConn = new ftpPasv(this.host, port);
    }
};

(function() {
    this.collectIncomingData = function(data) {
        this.data += data;
    };

    this.foundTerminator = function() {
        var data  = this.data;

        this.data = "";
        this.busy = true; // proper place??

        if (this.inMultiline > 0) {

            // If we are inside a multiline response, we append the data into the
            // last response buffer, instead of creating a new one.
            var len = this.response.length;
            if (len)
                this.response[len - 1] += "\n" + data;
            else
                this.response.push(data);

            // We check to see if the current data line is signaling the end of the
            // multiline response, in which case we set the `inMultiline` flag to 0
            var close = RE_RESPONSE.exec(data);
            if (close && close[1] === this.inMultiline)
                this.inMultiline = 0;
            else
                // In case it is not, we return immediately without processing the
                // response (yet)
                return;
        } else {
            // In case we are not in a multiline response, we check to see if the
            // current data line response is signaling the beginning of a multiline
            // one, in which case we set the `inMultiline` flag to the code of the
            // respo)se and return, to continue processing the rest of the response
            // lines.
            this.response.push(data);

            var blob = RE_MULTILINE.exec(data);
            if (blob) {
                this.inMultiline = blob[1];
                return;
            }
        }

        var ftpResponse = RE_RESPONSE.exec(data);
        if (!ftpResponse)
            return;

        var response  = this.response;
        this.response = [];

        response.forEach(function(line) {
            console.log("R:", line);
        });

        if (this.lastCmd) {
            if (this.customResponse[this.lastCmd]) {
                this.handler = this.customResponse[this.lastCmd];
                this.customResponse[this.lastCmd] = null;
            }
            else if (Ftp.handleResponse[this.lastCmd]) {
                this.handler = Ftp.handleResponse[this.lastCmd];
            }
        }

        // process response
        if (this.handler) {
            // call the response handler
            handler = this.handler;
            this.handler = null;

            var line = response[response.length - 1];
            var group = RE_RESPONSE.exec(line);

            var responseObj = {
                line: line,
                code: group ? group[1] : null,
                text: group ? group[2] : null
            };
            handler.call(this, responseObj);

            // The previous call could have set the handler, in whih case we return
            // to follow-up command in progress.
            if (this.handler)
                return;
        }

        this.processCmd();
    };

    this.processCmd = function(cmd) {
        if (!cmd) {
            if (this.commands.length) {
                var command = this.commands.shift();

                if (this.commands.length && typeof this.commands[0] === "function") {
                    this.handler = this.commands.shift();
                }
                console.log("\nC:", "'" + command + "'");

                this.push(command + "\r\n");
                // Retrieve the command name
                this.lastCmd = /^(\w+)\s*/.exec(command)[1];
            }
            else
                this.busy = false;
        }
        else {
            this.commands.push(cmd);
            if (!this.busy && this.acceptingConnections)
                this.processCmd();
        }
    };

    // Downloads a file from FTP server, given a valid Path. It uses the RETR
    // command to retrieve the file. the `get` and `retr` methods are synonymous of
    // this method.
    this.download = function(filePath) {
        this.type("I", function(typeRes) {
            var code = res.substring(0, 3); // get response code
            if (code === "250") {
                this.pasv();
                this.retr(filePath, function(retrRes) {
                    if (retrRes.substring(0, 3) === "150") {
                        console.log("alright")
                    }
                });
            }
        });
    };

    this.list = function(path, callback) {
        if (callback)
            this.customResponse[cmd] = callback;

        this.pasv();
        this.processCmd("LIST " + path);
    };

    // Connect handler
    this.ftpHandleConnect = function(res) {
        if (res.code === "220")
            this.acceptingConnections = true;
        else
            throw new Error("ftp login failed");
    };

}).call(Ftp.prototype);

