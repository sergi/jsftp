/*
A module supporting command/response protocols.

This class adds support for 'chat' style protocols - where one side
sends a 'command', and the other sends a response (examples would be
the common internet protocols - smtp, nntp, ftp, etc..).

The handle_read() method looks at the input stream for the current
'terminator' (usually '\r\n' for single-line responses, '\r\n.\r\n'
for multi-line output), calling self.found_terminator() on its
receipt.

for example:
Say you build an async nntp client using this class.  At the start
of the connection, you'll have self.terminator set to '\r\n', in
order to process the single-line greeting.  Just before issuing a
'LIST' command you'll set it to '\r\n.\r\n'.  The output of the LIST
command will be accumulated (using your own 'collect_incoming_data'
method) up to the terminator, and then control will be returned to
you - by calling your self.found_terminator() method.
*/

var Net = require("net");

var Gab = module.exports = function Gab() {
    var use_encoding = 0
    var encoding     = 'latin-1'

    // for string terminator matching
    this.inBuffer = "";
    this.incoming = [];
    this.fifo = [];
}

Gab.prototype = {
    setEncoding: function(encoding) {
        this.encoding = encoding;
    },
    connect: function(port, host) {
        var socket = this.socket = Net.createConnection(port, host);

        socket.setEncoding(this.encoding || "utf8");

        var self = this;
        socket.on("connect", function() {
            self.handleConnect.call(self);
        });

        socket.on("data", function(data) {
            self.handleRead.call(self, data);
        });

        socket.on("error", function(err) {
            self.handleError(err);
        });

        socket.on("close", function(hadError) {
            self.handleEnd(self, hadError);
        });

        socket.on("end", function() {
            self.handleEnd();
        });

        socket.on("timeout", function() {
            self.handleTimeout();
        });

    },
    handleConnect: function(e) {
        this.connected = true;
    },
    handleRead: function(data) {
        // Continue to search for self.terminator in self.ac_in_buffer,
        // while calling self.collect_incoming_data.  The while loop
        // stream is necessary because we might read several data+terminator
        // is necessary because we might read several data+terminator
        // combos with a single recv(4096).

        this.inBuffer += data;

        while (this.inBuffer) {
            var dataLen = this.inBuffer.length;
            var terminator = this.terminator;

            if (!terminator) {
                // no terminator, collect it all
                this.collectIncomingData(this.inBuffer);
                this.inBuffer = "";
            }
            // The terminator can be a number, in which case we assume it is
            // refering to the number of bytes we want to get.
            else if (typeof terminator === "number") {
                var n = terminator;
                if (dataLen < n) {
                    this.collectIncomingData(this.inBuffer);
                    this.terminator -= dataLen
                    this.inBuffer = "";
                }
                else {
                    this.collectIncomingData(this.inBuffer.substring(0, n));
                    this.inBuffer = this.inBuffer.substring(n);
                    this.terminator = 0;
                    this.foundTerminator();
                }
            }
            else {
                // 3 cases:
                // 1) end of buffer matches terminator exactly:
                //    collect data, transition
                // 2) end of buffer matches some prefix:
                //    collect data to the prefix
                // 3) end of buffer does not match any prefix:
                //    collect data
                var terminatorLen = terminator.length;
                var index = this.inBuffer.indexOf(terminator);

                if (index != -1) {
                    // we found the terminator
                    if (index > 0)
                        // don't bother reporting the empty string (source of subtle bugs)
                        this.collectIncomingData (this.inBuffer.substring(0, index));
                    this.inBuffer = this.inBuffer.substring(index + terminatorLen);
                    // This does the Right Thing if the terminator is changed here.
                    this.foundTerminator()
                }
                else {
                    // check for a prefix of the terminator
                    index = findPrefixAtEnd(this.inBuffer, terminator);
                    if (index) {
                        if (index != dataLen) {
                            // we found a prefix, collect up to the prefix
                            this.collectIncomingData(this.inBuffer.substring(0, index));
                            this.inBuffer = this.inBuffer.substring(index);
                        }
                        break;
                    }
                    else {
                        // no prefix, collect it all
                        this.collectIncomingData(this.inBuffer);
                        this.inBuffer = "";
                    }
                }
            }
        }
    },
    handleEnd: function(e) {

    },
    send: function(data) {
        if (!this.socket || !this.writable())
            this.handleError(new Error("The socket doesn't exist or is not writable"));

        if (!this.connected) {
            console.error("The socket is not connected.");
            return;
        }

        return this.socket.write(data)
    },

    push: function(data) {
        this.fifo.push(data);
        return this.initiateSend();
    },

    initiateSend: function() {
        if (this.fifo.length)
            this.send(this.fifo.shift());
    },

    handleError: function(e) {
        console.error("An error ocurred:", e);
        this.close();
    },

    handleClose: function() {
        this.connected = false;

        try {
            this.socket.end();
        } catch (e) {
            // If not ENOTCONN or EBADF
            // if why.args[0] not in (ENOTCONN, EBADF):
                //raise
            this.socket.destroy();
            throw e;
        }
    },

    handleTimeout: function() {

    },

    close: function() {
        this.socket.end();
    },

    collectIncomingData: function(data) {
        throw new NotImplementedError("must be implemented in subclass")
    },

    foundTerminator: function() {
        throw new NotImplementedError("must be implemented in subclass")
    },

    setTerminator: function(term) {
        //if (typeof term === "string" && this.use_encoding)
            //term = bytes(term, self.encoding)

        this.terminator = term;
    },

    writable: function() {
        return true;
    }
}

