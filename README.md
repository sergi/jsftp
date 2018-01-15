# jsftp

[![travis][travis-image]][travis-url] [![npm][npm-image]][npm-url]
[![downloads][downloads-image]][downloads-url]
[![styled with prettier](https://img.shields.io/badge/styled_with-prettier-ff69b4.svg)](https://github.com/prettier/prettier)

[travis-image]: https://img.shields.io/travis/sergi/jsftp.svg?style=flat
[travis-url]: https://travis-ci.org/sergi/jsftp
[npm-image]: https://img.shields.io/npm/v/jsftp.svg?style=flat
[npm-url]: https://npmjs.org/package/jsftp
[downloads-image]: https://img.shields.io/npm/dm/jsftp.svg?style=flat
[downloads-url]: https://npmjs.org/package/jsftp(https://github.com/prettier/prettier)

A client FTP library for NodeJS that focuses on correctness, clarity and
conciseness. It doesn't get in the way and plays nice with streaming APIs.

## Starting it up

```javascript
const jsftp = require("jsftp");

const Ftp = new jsftp({
  host: "myserver.com",
  port: 3331, // defaults to 21
  user: "user", // defaults to "anonymous"
  pass: "1234" // defaults to "@anonymous"
});
```

jsftp gives you access to all the raw commands of the FTP protocol in form of
methods in the `Ftp` object. It also provides several convenience methods for
actions that require complex chains of commands (e.g. uploading and retrieving
files, passive operations), as shown below.

When raw commands succeed they always pass the response of the server to the
callback, in the form of an object that contains two properties: `code`, which
is the response code of the FTP operation, and `text`, which is the complete
text of the response.

Raw (or native) commands are accessible in the form `Ftp.raw(command, params, callback)`

Thus, a command like `QUIT` will be called like this:

```javascript
Ftp.raw("quit", (err, data) => {
  if (err) {
    return console.error(err);
  }

  console.log("Bye!");
});
```

and a command like `MKD` (make directory), which accepts parameters, looks like
this:

```javascript
Ftp.raw("mkd", "/new_dir", (err, data) => {
  if (err) {
    return console.error(err);
  }
  console.log(data.text); // Show the FTP response text to the user
  console.log(data.code); // Show the FTP response code to the user
});
```

## API and examples

#### new Ftp(options)

* `options` is an object with the following properties:

```javascript
{
  host: 'localhost', // Host name for the current FTP server.
  port: 3333, // Port number for the current FTP server (defaults to 21).
  user: 'user', // Username
  pass: 'pass', // Password
  createSocket: ({port, host}, firstAction) => {
    return net.createConnection({port, host}, firstAction);
  }, // function that creates the socket, default uses net.createConnection
}
```

* `options.createSocket` could be used to implement a proxy for the ftp socket, e.g. socksv5

```javascript
const {SocksClient} = require('socks');
const ftp = new Ffp({
  host: 'localhost',
  port: 3333,
  user: 'user',
  pass: 'password',
  createSocket: ({port, host}, firstAction) => {
    return SocksClient.createConnection({
      proxy: {
        ipaddress: '159.203.75.200'
        port: 1080,
        type: 5
      },

      command: 'connect',

      destination: {
        host,
        port
      }
    })
  }
})
```

Creates a new Ftp instance.

#### Ftp.host

Host name for the current FTP server.

#### Ftp.port

Port number for the current FTP server (defaults to 21).

#### Ftp.socket

NodeJS socket for the current FTP server.

#### Ftp.features

Array of feature names for the current FTP server. It is generated when the user
authenticates with the `auth` method.

#### Ftp.system

Contains the system identification string for the remote FTP server.

### Methods

#### Ftp.raw(command, [...args], callback)

With the `raw` method you can send any FTP command to the server. The method
accepts a callback with the signature `err, data`, in which `err` is the error
response coming from the server (usually a 4xx or 5xx error code) and the data
is an object that contains two properties: `code` and `text`. `code` is an
integer indicating the response code of the response and `text` is the response
string itself.

#### Ftp.auth(username, password, callback)

Authenticates the user with the given username and password. If null or empty
values are passed for those, `auth` will use anonymous credentials. `callback`
will be called with the response text in case of successful login or with an
error as a first parameter, in normal Node fashion.

#### Ftp.ls(filePath, callback)

Lists information about files or directories and yields an array of file objects
with parsed file properties to the `callback`. You should use this function
instead of `stat` or `list` in case you need to do something with the individual
file properties.

```javascript
ftp.ls(".", (err, res) => {
  res.forEach(file => console.log(file.name));
});
```

#### Ftp.list(filePath, callback)

Lists `filePath` contents using a passive connection. Calls callback with a
string containing the directory contents in long list format.

```javascript
ftp.list(remoteCWD, (err, res) => {
  console.log(res);
  // Prints something like
  // -rw-r--r--   1 sergi    staff           4 Jun 03 09:32 testfile1.txt
  // -rw-r--r--   1 sergi    staff           4 Jun 03 09:31 testfile2.txt
  // -rw-r--r--   1 sergi    staff           0 May 29 13:05 testfile3.txt
  // ...
});
```

#### Ftp.get(remotePath, callback)

Gives back a paused socket with the file contents ready to be streamed, or calls
the callback with an error if not successful.

```javascript
var str = ""; // Will store the contents of the file
ftp.get("remote/path/file.txt", (err, socket) => {
  if (err) {
    return;
  }

  socket.on("data", d => {
    str += d.toString();
  });

  socket.on("close", err => {
    if (hadErr) {
      console.error("There was an error retrieving the file.");
    }
  });

  socket.resume();
});
```

#### Ftp.get(remotePath, localPath, callback)

Stores the remote file directly in the given local path.

```javascript
ftp.get("remote/file.txt", "local/file.txt", err => {
  if (hadErr) {
    return console.error("There was an error retrieving the file.");
  }
  console.log("File copied successfully!");
});
```

#### Ftp.put(source, remotePath, callback)

Uploads a file to `filePath`. It accepts a string with the local path for the
file, a `Buffer`, or a Readable stream as a `source` parameter.

```javascript
ftp.put(buffer, "path/to/remote/file.txt", err => {
  if (!err) {
    console.log("File transferred successfully!");
  }
});
```

#### Ftp.rename(from, to, callback)

Renames a file in the server. `from` and `to` are both filepaths.

```javascript
ftp.rename(from, to, (err, res) => {
  if (!err) {
    console.log("Renaming successful!");
  }
});
```

#### Ftp.keepAlive([wait])

Refreshes the interval thats keep the server connection active. `wait` is an
optional time period (in milliseconds) to wait between intervals.

You can find more usage examples in the
[unit tests](https://github.com/sergi/jsftp/blob/master/test/jsftp_test.js).
This documentation will grow as jsftp evolves.

<!-- ## Debugging

In order to enable debug mode in a FTP connection, a `debugMode` parameter can
be used in the constructors's config object:

```javascript
var Ftp = new JSFtp({
  host: "myserver.com",
  port: 3331,
  user: "user",
  pass: "1234",
  debugMode: true
});
```

It can also be activated or deactivated by calling the `setDebugMode` method:

```javascript
Ftp.setDebugMode(true); // Debug Mode on
Ftp.setDebugMode(false); // Debug mode off
```

If the debug mode is on, the jsftp instance will emit `jsftp_debug` events with
two parameters: the first is the type of the event and the second and object
including data related to the event. There are 3 possible types of events:

* `response` events: These are response from the FTP server to the user's FTP
  commands

* `user_command` events: These are commands that the user issues to the FTP
  server.

* `event:{event name}` events: These are other events mostly related to the
  server connection, such as `timeout`, `connect` or `disconnect`. For example,
  a timeout event will have the name `event:timeout`.

In order to react to print all debug events (for example), we would listen to
the debug messages like this:

```javascript
Ftp.on("jsftp_debug", function(eventType, data) {
  console.log("DEBUG: ", eventType);
  console.log(JSON.stringify(data, null, 2));
});
``` -->

## Installation

    npm install jsftp

## Tests and Coverage

JSFtp tests against ProFTPD by default. To accomplish that, it uses a Docker set-up, so you'll need Docker installed in your machine in order to run tests.

To run tests and coverage reports:

    npm test

    ...
    43 passing (10s)

    |-----------|----------|----------|----------|----------|----------------|
    |File       |  % Stmts | % Branch |  % Funcs |  % Lines |Uncovered Lines |
    |-----------|----------|----------|----------|----------|----------------|
    |All files  |    86.47 |    73.17 |    95.45 |    86.47 |                |
    |jsftp      |      100 |      100 |      100 |      100 |                |
    |  index.js |      100 |      100 |      100 |      100 |                |
    |jsftp/lib  |    86.43 |    73.17 |    95.45 |    86.43 |                |
    |  jsftp.js |    86.43 |    73.17 |    95.45 |    86.43 |... 722,724,733 |
    |-----------|----------|----------|----------|----------|----------------|

## License

See LICENSE.
