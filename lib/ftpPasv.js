/*
 * @package jsFTP
 * @copyright Copyright(c) 2011 Ajax.org B.V. <info AT ajax DOT org>
 * @author Sergi Mansilla <sergi DOT mansilla AT gmail DOT com>
 * @license https://github.com/sergi/jsFTP/blob/master/LICENSE MIT License
 */

var Net = require("net");
var S;
try { S = require("streamer"); }
catch (e) { S = require("../support/streamer/core"); }

var ftpPasv = module.exports = function(cfg) {
    var data;
    var callback = cfg.callback;
    var socket = this.socket = Net.createConnection(cfg.port, cfg.host);

    socket.setEncoding("utf8");

    if (cfg.onConnect) {
        socket.on("connect", function() {
            if (cfg.mode)
                cfg.ftp.raw.type(cfg.mode, function(err, res) {
                    cfg.onConnect(socket);
                });
            else
                cfg.onConnect(socket)
        });
    }

    if (!callback || typeof callback != "function")
        callback = function() {};

    var input = function(next, stop) {
        socket.on("data", next);
        socket.on("end", stop);
        socket.on("error", stop);
    };

    var self = this;
    var requests = function(source) {
        source(function(result) {
            if (cfg.mode === "I")
                data = concat([data || [], result]);
            else
                data = [data, result].join("\n");
        }, function(error) {
            callback(error, data);
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

