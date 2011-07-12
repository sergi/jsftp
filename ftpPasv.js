var Net = require("net");
var Gab = require("./support/gab/gab");

var ftpPasv = module.exports = function(host, port) {
    Gab.apply(this, arguments);

    this.data = ""
    this.setTerminator("\r\n");

    this.connect(port, host);
};

ftpPasv.prototype = new Gab;
ftpPasv.prototype.constructor = ftpPasv;

(function() {

    this.collectIncomingData = function(data) {
        this.data += data;
    };

    this.foundTerminator = function() {
        var data = this.data;
        this.data = "";
        console.log(data)
    };

    this.writable = function() {
        return false;
    };

    this.handleExpt = function() {
        this.close();
    };

    this.handleClose = function() {
        this.close();
    };
}).call(ftpPasv.prototype);

