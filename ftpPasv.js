var Net = require("net");
var S = require("./streamer");

var ftpPasv = module.exports = function(host, port, mode, callback, onConnect) {
    this.data = [];
    this.mode = mode;

    var socket = this.socket = Net.createConnection(port, host);
    socket.setEncoding("utf8");

    if (onConnect)
        socket.on("connect", function() { onConnect(socket); });

    var input = function(next, stop) {
        socket.on("data", next);
        socket.on("end", stop);
        socket.on("error", stop);
    };

    var self = this;
    var requests = function(source) {
        source(function(data) {
            self.data.push(data);
        }, function(error) {
            if (error)
                callback(error);

            if (mode === "I")
                callback(null, concat(self.data));
            else if(mode === "A")
                callback(null, self.data.join("\n"));
        });
    };

    var incoming = S.list(requests(input));
};

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

