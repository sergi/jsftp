var Net = require("net");
var Gab = require("./support/gab/gab");

var ftpPasv = module.exports = function(host, port, mode, callback) {
    Gab.apply(this, arguments);

    this.data = [];
    this.mode = mode;

    var self = this;
    if (mode === "I") { // Binary mode
        this.handleEnd = function(e) {
            callback(e, concat(self.data))
        };
        this.setTerminator();
    }
    else {
        this.handleEnd = function(e) {
            callback(e || null, self.data.join("\n"))//.replace("", ""))
        }
        this.setTerminator("\r\n");
    }

    this.connect(port, host);
};

ftpPasv.prototype = new Gab;
ftpPasv.prototype.constructor = ftpPasv;

(function() {

    this.collectIncomingData = function(data) {
        this.data.push(data);
    };

    this.foundTerminator = function() {};

    this.writable = function() {
        return false;
    };

}).call(ftpPasv.prototype);


// From https://github.com/coolaj86/node-bufferjs
function concat(bufs) {
    var buffer, length = 0, index = 0;

    if (!Array.isArray(bufs))
        bufs = Array.prototype.slice.call(arguments);

    for (var i=0, l=bufs.length; i<l; i++) {
        buffer = bufs[i];

        if (!Buffer.isBuffer(buffer))
            buffer = bufs[i] = new Buffer(buffer);

        length += buffer.length;
    }

    buffer = new Buffer(length);

    bufs.forEach(function (buf, i) {
        buf = bufs[i];
        buf.copy(buffer, index, 0, buf.length);
        index += buf.length;
        delete bufs[i];
    });

    return buffer;
}

