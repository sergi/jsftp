var Net = require("net");
var Gab = require("../gab");

var FTP_PORT = 21;

var RE_PASV = /[-\d]+,[-\d]+,[-\d]+,[-\d]+,([-\d]+),([-\d]+)/;
var RE_NEWLINE = /\r\n|\n/;
var RE_NEWLINE_END = /\r\n|\n$/;
var RE_MULTILINE  = /(\d\d\d)-/;
var RE_RESPONSE = /^(\d\d\d)\s/;

var Ftp = function (cfg) {
    Gab.apply(this, arguments);

    var port = this.port = cfg.port || FTP_PORT;
    var host = this.host = cfg.host;
    var user = this.user = cfg.user;
    var pass = this.pass = cfg.pass;

    this.data = "";
    this.commands = [];
    this.response = [];
    this.inMultiline = 0;
    this.handler = this.ftpHandleConnect;

    this.setTerminator("\r\n");
    this.setEncoding("utf8");

    this.connect(port, host);
};

Ftp.prototype = new Gab;
Ftp.prototype.constructor = Ftp;

Ftp.handleResponse = {
    "USER": function(res) {
        var code = res.substring(0, 3); // get response code
        if (code === "230") {
            return; // user accepted
        }
        else if (code === "331" || code === "332") {
            this.push("PASS " + this.pass + "\r\n");
            this.handler = Ftp.handleResponse.PASS;
        }
        else {
            throw new Error("ftp login failed: user name not accepted");
        }
    },
    "PASS": function(res) {
        var code = res.substring(0, 3); // get response code
        if (code === "230") {
            return; // user and password accepted
        }
        else {
            throw new Error("ftp login failed: password not accepted");
        }
    },
    "PASV": function(res) {
        var code = res.substring(0, 3); // get response code
        if (code !== "227")
            return; // pasv failed

        var match = RE_PASV.exec(res);
        if (!match)
            return; // bad port

        var port = (parseInt(match[1]) & 255) * 256 + (parseInt(match[2]) & 255);
        // establish data connection
        new ftpDownload(this.host, port);
    }
};

Ftp.prototype.collectIncomingData = function(data) {
    this.data += data;
};

Ftp.prototype.foundTerminator = function() {
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
        // multiline response, in which case we set the `inMultiline` flag to
        // 0. In case it is not, we return immediately without processing the
        // response (yet).
        var close = RE_RESPONSE.exec(data);
        if (close && close[1] === this.inMultiline)
            this.inMultiline = 0;
        else
            return;
    } else {
        // In case we are not in a multiline response, we check to see if the
        // current data line response is signaling the beginning of a multiline
        // one, in which case we set the `inMultiline` flag to the code of the
        // response and return, to continue processing the rest of the response
        // lines.
        var blob = RE_MULTILINE.exec(data);
        if (blob) {
            this.response.push(data);
            this.inMultiline = blob[1];
            return;
        }
        else {
            this.response.push(data);
        }
    }

    var ftpResponse = RE_RESPONSE.test(data);
    if (!ftpResponse)
        return;

    var response  = this.response;
    this.response = [];

    response.forEach(function(line) {
        console.log("S:", line);
    });

    // process response
    if (this.handler) {
        // call the response handler
        handler = this.handler;
        this.handler = null;

        handler.call(this, response[response.length - 1]);

        // The previous call could have set the handler, in whih case we return
        // to follow-up command in progress.
        if (this.handler)
            return;
    }

    this.processCmd();
};

Ftp.prototype.processCmd = function(cmd) {
    if (!cmd) {
        if (this.commands.length) {
            var command = this.commands.shift();

            if (this.commands.length && typeof this.commands[0] === "function") {
                this.handler = this.commands.shift();
            }
            console.log("C:", "'" + command + "'");

            this.push(command + "\r\n");
        } else {
            this.busy = false;
        }
    }
    else {
        this.commands.push(cmd);
        if (!this.busy && this.connected)
            this.processCmd();
    }
};

/**
 * http://cr.yp.to/ftp/type.html
 */
Ftp.prototype.setBinary = function(enabled) {
    this.commands.push( "TYPE " + (enabled ? "I" : "A") );
};
Ftp.prototype.type = Ftp.prototype.setBinary;

// Downloads a file from FTP server, given a valid Path. It uses the RETR
// command to retrieve the file. the `get` and `retr` methods are synonymous of
// this method.
Ftp.prototype.download = function(filePath) {
    this.setBinary(true);
    if (filePath) {
        this.processCmd("PASV");
    }
};
Ftp.prototype.get  = Ftp.prototype.download;
Ftp.prototype.retr = Ftp.prototype.download;

Ftp.prototype.list = function(path) {
    this.processCmd("STAT " + path);
};

Ftp.prototype.pwd = function(path) {
    this.processCmd("PWD");
};

Ftp.prototype.quit = function(path) {
    this.processCmd("QUIT");
};

Ftp.prototype.ftpHandleConnect = function(res) {
    var code = res.substring(0, 3); // get response code
    if (code === "220") {
        this.push("USER " + this.user + "\r\n");
        this.handler = Ftp.handleResponse["USER"];
    }
    else {
        throw new Error("ftp login failed");
    }
};

var ftpDownload = function(host, port) {
    Gab.apply(this, arguments);

    this.setTerminator("\n");

    this.socket = Net.createConnection(port, host);
    this.connect(host, port);
};

ftpDownload.prototype = new Gab;
ftpDownload.prototype.constructor = ftpDownload;

ftpDownload.prototype.writable = function() {
    return false;
};

ftpDownload.prototype.handleConnect = function(e) { console.log(e); };

ftpDownload.prototype.handleExpt = function() {
    this.close();
};

ftpDownload.prototype.handleClose = function() {
    this.close();
};



// Fire it up. For test purposes only!
var ftp = new Ftp({
    port: 21,
    host: "sergimansilla.com",
    user: "mrclash",
    pass: "ketu48"
});

ftp.list("/");
ftp.pwd();
ftp.setBinary(true);

setTimeout(function(){ftp.quit();}, 15000);

