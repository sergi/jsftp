var Net = require("net");
var Gab = require("../gab");

var FTP_PORT = 21;

var anonFtp = function (cfg) {
    Gab.apply(this, arguments);

    this.data = ""

    var port = cfg.port;
    var host = cfg.host;

    this.commands = [
        "QUIT",
        "PWD",
        "PASS 2x8hebsndr9",
        "USER sergi",
    ];

    this.setTerminator("\n");
    this.setEncoding("utf8")

    this.connect(port, host);
}

anonFtp.prototype = new Gab;
anonFtp.prototype.constructor = anonFtp;

anonFtp.prototype.collectIncomingData = function(data) {
    this.data += data;
};

anonFtp.prototype.foundTerminator = function() {
    var data = this.data;
    var command;

    if (data.charAt(data.length - 1) === "\r")
        data = data.substring(0, data.length - 2);

    this.data = "";

    console.log("S:", data);

    if (/\d\d\d/.test(data)) {
        if (this.commands.length) {
            command = this.commands.pop();
            console.log("C:", command)
            this.push(command + "\r\n");
        }
    }
};

var ftp = new anonFtp({
    port: 2021,
    host: "localhost"
});
