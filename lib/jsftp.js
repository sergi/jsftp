/* vim:set ts=2 sw=2 sts=2 expandtab */
/*global require: true module: true */
/*
 * @package jsftp
 * @copyright Copyright(c) 2012 Ajax.org B.V. <info@c9.io>
 * @author Sergi Mansilla <sergi.mansilla@gmail.com>
 * @license https://github.com/sergi/jsFTP/blob/master/LICENSE MIT License
 */

"use strict";

const  createConnection = require("net").createConnection;
const EventEmitter = require("events").EventEmitter;
const inherits = require("util").inherits;
const stream = require("stream");
const fs = require("fs");
const combine = require("stream-combiner");

const ResponseParser = require("ftp-response-parser");
const ListingParser = require("parse-listing");
const once = require("once");
const nfc = require("unorm").nfc;

const debug = require("debug")("jsftp:general");
const dbgCommand = require("debug")("jsftp:command");
const dbgResponse = require("debug")("jsftp:response");

const FTP_HOST = "localhost";
const FTP_PORT = 21;
const TIMEOUT = 10 * 60 * 1000;
const IDLE_TIME = 30000;
const NOOP = function() {};

const expectedMarks = {
  marks: [125, 150],
  ignore: 226
};

const RE_PASV = /([-\d]+,[-\d]+,[-\d]+,[-\d]+),([-\d]+),([-\d]+)/;
const FTP_NEWLINE = /\r\n|\n/;

function runCmd(name, ...params) {
  let callback = NOOP;
  let completeCmd = name + " ";

  if (typeof params[params.length - 1] === "function") {
    callback = params.pop();
  }

  completeCmd += params.join(" ");
  this.execute(completeCmd.trim(), callback);
}

function Ftp(cfg) {
  this.host = cfg.host || FTP_HOST;
  this.port = cfg.port || FTP_PORT;
  this.user = cfg.user || "anonymous";
  this.pass = cfg.pass || "@anonymous";
  this.createSocket = cfg.createSocket;
  // True if the server doesn't support the `stat` command. Since listing a
  // directory or retrieving file properties is quite a common operation, it is
  // more efficient to avoid the round-trip to the server.
  this.useList = cfg.useList || false;

  this.commandQueue = [];

  EventEmitter.call(this);

  this.on("data", dbgResponse);

  this._createSocket(this.port, this.host);
}

inherits(Ftp, EventEmitter);

// Generate generic methods from parameter names. they can easily be
// overriden if we need special behavior. they accept any parameters given,
// it is the responsibility of the user to validate the parameters.
Ftp.prototype.raw = function() {
  runCmd.apply(this, arguments);
};

Ftp.prototype.reemit = function(event) {
  return data => {
    this.emit(event, data);
    debug(`event:${event}`, data || {});
  };
};

Ftp.prototype._createSocket = function(port, host, firstAction = NOOP) {
  if (this.socket && this.socket.destroy) {
    this.socket.destroy();
  }

  if (this.resParser) {
    this.resParser.end();
  }
  this.resParser = new ResponseParser();

  this.authenticated = false;
  this.socket = this.createSocket
    ? this.createSocket({ port, host }, firstAction)
    : createConnection(port, host, firstAction);
  this.socket.on("connect", this.reemit("connect"));
  this.socket.on("timeout", this.reemit("timeout"));

  this.pipeline = combine(this.socket, this.resParser);

  this.pipeline.on("data", data => {
    this.emit("data", data);
    dbgResponse(data.text);
    this.parseResponse(data);
  });
  this.pipeline.on("error", this.reemit("error"));
};

Ftp.prototype.parseResponse = function(response) {
  if (this.commandQueue.length === 0) {
    return;
  }
  if ([220].indexOf(response.code) > -1) {
    return;
  }

  const next = this.commandQueue[0].callback;
  if (response.isMark) {
    // If we receive a Mark and it is not expected, we ignore that command
    if (
      !next.expectsMark ||
      next.expectsMark.marks.indexOf(response.code) === -1
    ) {
      return;
    }

    // We might have to ignore the command that comes after the mark.
    if (next.expectsMark.ignore) {
      this.ignoreCmdCode = next.expectsMark.ignore;
    }
  }

  if (this.ignoreCmdCode === response.code) {
    this.ignoreCmdCode = null;
    return;
  }

  this.parse(response, this.commandQueue.shift());
};

/**
 * Sends a new command to the server.
 *
 * @param {String} command Command to write in the FTP socket
 */
Ftp.prototype.send = function(command) {
  if (!command) {
    return;
  }

  dbgCommand(command);
  this.pipeline.write(command + "\r\n");

  dbgCommand(command);
};

Ftp.prototype.nextCmd = function() {
  const cmd = this.commandQueue[0];
  if (!this.inProgress && cmd) {
    this.send(cmd.action);
    this.inProgress = true;
  }
};

/**
 * Check whether the ftp user is authenticated at the moment of the
 * enqueing. ideally this should happen in the `push` method, just
 * before writing to the socket, but that would be complicated,
 * since we would have to 'unshift' the auth chain into the queue
 * or play the raw auth commands (that is, without enqueuing in
 * order to not mess up the queue order. ideally, that would be
 * built into the queue object. all this explanation to justify a
 * slight slopiness in the code flow.
 *
 * @param {string} action
 * @param {function} callback
 */
Ftp.prototype.execute = function(action, callback = NOOP) {
  if (this.socket && this.socket.writable) {
    return this.runCommand({ action, callback });
  }

  this.authenticated = false;
  this._createSocket(this.port, this.host, () => {
    this.runCommand({ action, callback });
  });
};

Ftp.prototype.runCommand = function(cmd) {
  if (this.authenticated || /^(feat|syst|user|pass)/.test(cmd.action)) {
    this.commandQueue.push(cmd);
    this.nextCmd();
    return;
  }

  this.getFeatures(() => {
    this.auth(this.user, this.pass, () => {
      this.commandQueue.push(cmd);
      this.nextCmd();
    });
  });
};

/**
 * Parse is called each time that a comand and a request are paired
 * together. That is, each time that there is a round trip of actions
 * between the client and the server.
 *
 * @param {Object} response Response from the server (contains text and code)
 * @param {Array} command Contains the command executed and a callback (if any)
 */
Ftp.prototype.parse = function(response, command) {
  let err = null;
  if (response.isError) {
    err = new Error(response.text || "Unknown FTP error.");
    err.code = response.code;
  }

  this.inProgress = false;
  command.callback(err, response);
  this.nextCmd();
};

Ftp.prototype.getPasvPort = function(text) {
  const match = RE_PASV.exec(text);
  if (!match) {
    return null;
  }

  let host = match[1].replace(/,/g, ".");
  if (host === "127.0.0.1") {
    host = this.host;
  }

  return {
    host,
    port: (parseInt(match[2], 10) & 255) * 256 + (parseInt(match[3], 10) & 255)
  };
};

/**
 * Returns true if the current server has the requested feature.
 *
 * @param {String} feature Feature to look for
 * @return {Boolean} Whether the current server has the feature
 */
Ftp.prototype.hasFeat = function(feature) {
  return !!feature && this.features.indexOf(feature.toLowerCase()) > -1;
};

/**
 * Returns an array of features supported by the current FTP server
 *
 * @param {String} features Server response for the 'FEAT' command
 * @return {String[]} Array of feature names
 */
Ftp.prototype._parseFeats = function(features) {
  // Split and ignore header and footer
  const featureLines = features.split(FTP_NEWLINE).slice(1, -1);
  return featureLines
    .map(feat => feat.trim().toLowerCase())
    .filter(feat => !!feat);
};

// Below this point all the methods are action helpers for FTP that compose
// several actions in one command
Ftp.prototype.getFeatures = function(callback) {
  if (this.features) {
    return callback(null, this.features);
  }

  this.raw("feat", (err, response) => {
    this.features = err ? [] : this._parseFeats(response.text);
    this.raw("syst", (err, res) => {
      if (!err && res.code === 215) {
        this.system = res.text.toLowerCase();
      }

      callback(null, this.features);
    });
  });
};

/**
 * Authenticates the user.
 *
 * @param {String} user Username
 * @param {String} pass Password
 * @param {Function} callback Follow-up function.
 */
Ftp.prototype.auth = function(user, pass, callback) {
  if (this.authenticating === true) {
    return callback(new Error("This client is already authenticating"));
  }

  if (!user) {
    user = "anonymous";
  }
  if (!pass) {
    pass = "@anonymous";
  }

  this.authenticating = true;
  this.raw("user", user, (err, res) => {
    if (err || [230, 331, 332].indexOf(res.code) === -1) {
      this.authenticating = false;
      callback(err);
      return;
    }
    this.raw("pass", pass, (err, res) => {
      this.authenticating = false;

      if (err) {
        callback(err);
      } else if ([230, 202].indexOf(res.code) > -1) {
        this.authenticated = true;
        this.user = user;
        this.pass = pass;
        this.raw("type", "I", () => {
          callback(undefined, res);
        });
      } else if (res.code === 332) {
        this.raw("acct", ""); // ACCT not really supported
      }
    });
  });
};

Ftp.prototype.setType = function(type, callback) {
  type = type.toUpperCase();
  if (this.type === type) {
    return callback();
  }

  this.raw("type", type, (err, data) => {
    if (!err) {
      this.type = type;
    }

    callback(err, data);
  });
};

/**
 * Lists a folder's contents using a passive connection.
 *
 * @param {String} path Remote path for the file/folder to retrieve
 * @param {Function} callback Function to call with errors or results
 */
Ftp.prototype.list = function(path, callback) {
  if (arguments.length === 1) {
    callback = arguments[0];
    path = "";
  }

  let listing = "";
  callback = once(callback);

  this.getPasvSocket((err, socket) => {
    if (err) {
      return callback(err);
    }

    socket.setEncoding("utf8");
    socket.on("data", data => {
      listing += data;
    });

    this.pasvTimeout(socket, callback);

    socket.once("close", err => {
      if (err) {
        return callback(err);
      } else if (!listing) {
        // Some servers return empty string
        return callback({
          code: 451,
          text: `Could not retrieve a file listing for ${path}.`,
          isMark: false,
          isError: true
        });
      }
      callback(null, listing);
    });
    socket.once("error", callback);

    function cmdCallback(err, res) {
      if (err) {
        return callback(err);
      }

      const isExpectedMark = expectedMarks.marks.some(
        mark => mark === res.code
      );

      if (!isExpectedMark) {
        callback(
          new Error(
            `Expected marks ${expectedMarks.toString()} instead of: ${res.text}`
          )
        );
      }
    }

    cmdCallback.expectsMark = expectedMarks;

    this.execute(`list ${path || ""}`, cmdCallback);
  });
};

Ftp.prototype.emitProgress = function(data) {
  this.emit("progress", {
    filename: data.filename,
    action: data.action,
    total: data.totalSize || 0,
    transferred:
      data.socket[data.action === "get" ? "bytesRead" : "bytesWritten"]
  });
};

/**
 * Depending on the number of parameters, returns the content of the specified
 * file or directly saves a file into the specified destination. In the latter
 * case, an optional callback can be provided, which will receive the error in
 * case the operation was not successful.
 *
 * @param {String} remotePath File to be retrieved from the FTP server
 * @param {Function|String} localPath Local path where we create the new file
 * @param {Function} [callback] Gets called on either success or failure
 */
Ftp.prototype.get = function(remotePath, localPath, callback = NOOP) {
  let finalCallback;
  const typeofLocalPath = typeof localPath;

  if (typeofLocalPath === "function") {
    finalCallback = localPath;
  } else if (typeofLocalPath === "string") {
    callback = once(callback);
    finalCallback = (err, socket) => {
      if (err) {
        return callback(err);
      }

      const writeStream = fs.createWriteStream(localPath);
      writeStream.on("error", callback);

      socket.on("readable", () => {
        this.emitProgress({
          filename: remotePath,
          action: "get",
          socket: socket
        });
      });

      // This ensures that any expected outcome is handled. There is no
      // danger of the callback being executed several times, because it is
      // wrapped in `once`.
      socket.on("error", callback);
      socket.on("end", callback);
      socket.on("close", callback);

      socket.pipe(writeStream);
    };
  }

  this.getGetSocket(remotePath, once(finalCallback));
};

/**
 * Returns a socket for a get (RETR) on a path. The socket is ready to be
 * streamed, but it is returned in a paused state. It is left to the user to
 * resume it.
 *
 * @param {String} path Path to the file to be retrieved
 * @param {Function} callback Function to call when finalized, with the socket
 * as a parameter
 */
Ftp.prototype.getGetSocket = function(path, callback) {
  callback = once(callback);
  this.getPasvSocket((err, socket) => {
    if (err) {
      return cmdCallback(err);
    }

    socket.on("error", err => {
      if (err.code === "ECONNREFUSED") {
        err.msg = "Probably trying a PASV operation while one is in progress";
      }
      cmdCallback(err);
    });

    this.pasvTimeout(socket, cmdCallback);
    socket.pause();

    function cmdCallback(err, res) {
      if (err) {
        if (socket) {
          // close the socket since it won't be used
          socket.destroy();
        }
        return callback(err);
      }

      if (!socket) {
        return callback(new Error("Error when retrieving PASV socket"));
      }

      if (res.code === 125 || res.code === 150) {
        return callback(null, socket);
      }

      // close the socket since it won't be used
      socket.destroy();

      return callback(new Error("Unexpected command " + res.text));
    }

    cmdCallback.expectsMark = expectedMarks;
    this.execute("retr " + path, cmdCallback);
  });
};

/**
 * Uploads contents on a FTP server. The `from` parameter can be a Buffer or the
 * path for a local file to be uploaded.
 *
 * @param {String|Buffer} from Contents to be uploaded.
 * @param {String} to path for the remote destination.
 * @param {Function} callback Function to execute on error or success.
 */
Ftp.prototype.put = function(from, destination, callback) {
  const putReadable = (from, to, totalSize) => {
    from.on("readable", () => {
      this.emitProgress({
        filename: to,
        action: "put",
        socket: from,
        totalSize
      });
    });

    this.getPutSocket(from, to, callback);
  };

  if (from instanceof Buffer) {
    this.getPutSocket(from, destination, callback);
  } else if (typeof from === "string") {
    fs.stat(from, (err, stats) => {
      if (err && err.code === "ENOENT") {
        return callback(new Error("Local file doesn't exist."));
      }

      if (stats.isDirectory()) {
        return callback(new Error("Local path cannot be a directory"));
      }

      const totalSize = err ? 0 : stats.size;
      putReadable(fs.createReadStream(from), destination, totalSize);
    });
  } else if (from instanceof stream.Readable) {
    putReadable(from, destination, 0);
  } else {
    callback(
      new Error("Expected `from` parameter to be a Buffer, Stream, or a String")
    );
  }
};

Ftp.prototype.getPutSocket = function(from, path, next) {
  next = once(next || NOOP);

  this.getPasvSocket((err, socket) => {
    if (err) {
      if (socket) {
        // close the socket since it won't be used
        socket.destroy();
      }
      return next(err);
    }

    socket.on("close", next);
    socket.on("error", next);

    const callback = once((err, res) => {
      if (err) {
        if (socket) {
          // close the socket since it won't be used
          socket.destroy();
        }
        return next(err);
      }

      // Mark 150 indicates that the 'STOR' socket is ready to receive data.
      // Anything else is not relevant.
      if (res.code === 125 || res.code === 150) {
        this.pasvTimeout(socket, next);
        if (from instanceof Buffer) {
          socket.end(from);
        } else if (from instanceof stream.Readable) {
          from.pipe(socket);
        }
      } else {
        if (socket) {
          // close the socket since it won't be used
          socket.destroy();
        }
        return next(new Error("Unexpected command " + res.text));
      }
    });

    callback.expectsMark = expectedMarks;

    this.execute(`stor ${path}`, callback);
  });
};

Ftp.prototype.pasvTimeout = function(socket, callback) {
  socket.once("timeout", () => {
    debug("PASV socket timeout");
    this.emit("timeout");
    socket.end();
    callback(new Error("Passive socket timeout"));
  });
};

Ftp.prototype.getPasvSocket = function(callback = NOOP) {
  callback = once(callback);

  this.execute("pasv", (err, res) => {
    if (err) {
      return callback(err);
    }

    const options = this.getPasvPort(res.text);
    if (!options) {
      return callback(new Error("Bad passive host/port combination"));
    }

    const socket = (this._pasvSocket = this.createSocket
      ? this.createSocket(options)
      : createConnection(options));
    socket.setTimeout(this.timeout || TIMEOUT);
    socket.once("close", () => {
      this._pasvSocket = undefined;
    });

    callback(null, socket);
  });
};

/**
 * Provides information about files. It lists a directory contents or
 * a single file and yields an array of file objects. The file objects
 * contain several properties. The main difference between this method and
 * 'list' or 'stat' is that it returns objects with the file properties
 * already parsed.
 *
 * Example of file object:
 *
 *  {
 *      name: 'README.txt',
 *      type: 0,
 *      time: 996052680000,
 *      size: '2582',
 *      owner: 'sergi',
 *      group: 'staff',
 *      userPermissions: { read: true, write: true, exec: false },
 *      groupPermissions: { read: true, write: false, exec: false },
 *      otherPermissions: { read: true, write: false, exec: false }
 *  }
 *
 * The constants used in the object are defined in ftpParser.js
 *
 * @param {String} filePath Path to the file or directory to list
 * @param {Function} callback Function to call with the proper data when
 * the listing is finished.
 */
Ftp.prototype.ls = function(filePath, callback) {
  function entriesToList(err, entries) {
    if (err) {
      return callback(err);
    }

    ListingParser.parseFtpEntries(entries.text || entries, (err, files) => {
      if (err) {
        return callback(err);
      }

      files.forEach(file => {
        // Normalize UTF8 doing canonical decomposition, followed by
        // canonical Composition
        file.name = nfc(file.name);
      });
      callback(null, files);
    });
  }

  if (this.useList) {
    this.list(filePath, entriesToList);
  } else {
    this.raw("stat", filePath, (err, data) => {
      // We might be connected to a server that doesn't support the
      // 'STAT' command, which is set as default. We use 'LIST' instead,
      // and we set the variable `useList` to true, to avoid extra round
      // trips to the server to check.
      const errored = err && (err.code === 502 || err.code === 500);
      const isHummingbird =
        this.system && this.system.indexOf("hummingbird") > -1;
      if (errored || isHummingbird) {
        // Not sure if the 'hummingbird' system check ^^^ is still
        // necessary. If they support any standards, the 500 error
        // should have us covered. Let's leave it for now.
        this.useList = true;
        this.list(filePath, entriesToList);
      } else {
        entriesToList(err, data);
      }
    });
  }
};

Ftp.prototype.rename = function(from, to, callback) {
  this.raw("rnfr", from, err => {
    if (err) {
      return callback(err);
    }
    this.raw("rnto", to, callback);
  });
};

Ftp.prototype.keepAlive = function(wait) {
  if (this._keepAliveInterval) {
    clearInterval(this._keepAliveInterval);
  }

  this._keepAliveInterval = setInterval(
    this.raw.bind(this, "noop"),
    wait || IDLE_TIME
  );
};

Ftp.prototype.destroy = function() {
  if (this._keepAliveInterval) {
    clearInterval(this._keepAliveInterval);
  }

  if (this.socket && this.socket.writable) {
    this.socket.end();
  }

  if (this._pasvSocket && this._pasvSocket.writable) {
    this._pasvSocket.end();
  }

  this.resParser.end();

  this.socket = undefined;
  this._pasvSocket = undefined;

  this.features = null;
  this.authenticated = false;
};

module.exports = Ftp;
