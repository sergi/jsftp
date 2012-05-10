/*
 * @package jsFTP
 * @copyright Copyright(c) 2011 Ajax.org B.V. <info AT ajax DOT org>
 * @author Sergi Mansilla <sergi DOT mansilla AT gmail DOT com>
 * @license https://github.com/sergi/jsFTP/blob/master/LICENSE MIT License
 */

var Net = require("net");
var S = require("streamer");

module.exports = function(cfg) {
    var callback = cfg.callback;
    var socket = this.socket = Net.createConnection(cfg.port, cfg.host);

    if (!callback || typeof callback != "function")
        callback = function() {};

    var input = function(next, stop) {
        socket.on("data", next);
        socket.on("end", stop);
        socket.on("error", stop);
    };

    var pieces = [];
    var requests = function(source) {
        source(function(result) {
            pieces.push(result);
        }, function(error) {
            if (error)
                callback(error);
            else if (cfg.mode === "I")
                callback(null, concat(pieces));
            else
                callback(null, pieces.join("\n"));
        });
    };

    S.list(requests(input));
};

// From https://github.com/coolaj86/node-bufferjs
function concat(bufs) {
    var buffer, length = 0, index = 0;

    if (!Array.isArray(bufs))
        bufs = Array.prototype.slice.call(arguments);

    for (var i=0, l=bufs.length; i<l; i++) {
        buffer = bufs[i];
        length += buffer.length;
    }

    buffer = new Buffer(length);

    bufs.forEach(function(buf, i) {
        buf.copy(buffer, index, 0, buf.length);
        index += buf.length;
    });

    return buffer;
}

