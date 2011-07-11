var Gab = require("./support/gab/gab");

var ftpPasv = module.exports = function(host, port) {
    Gab.apply(this, arguments);

    this.setTerminator("\n");

    this.socket = Net.createConnection(port, host);
    this.connect(host, port);
};

ftpPasv.prototype = new Gab;
ftpPasv.prototype.constructor = ftpPasv;

ftpPasv.prototype.writable = function() {
    return false;
};

ftpPasv.prototype.handleConnect = function(e) { console.log(e); };

ftpPasv.prototype.handleExpt = function() {
    this.close();
};

ftpPasv.prototype.handleClose = function() {
    this.close();
};
