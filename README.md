jsftp <a href="http://flattr.com/thing/1452098/" target="_blank"><img src="http://api.flattr.com/button/flattr-badge-large.png" alt="Flattr this" title="Flattr this" border="0" /></a>
=====

jsftp is a client FTP library for NodeJS that focuses on correctness, clarity
and conciseness. It doesn't get in the way and plays nice with streaming APIs.

**BIG Warning: The latest version (1.0.0) of jsftp breaks API compatibility with previous
versions, it is NOT a drop-in replacement. Please be careful when upgrading. The
API changes are not drastic at all and it is all documented below. If you do not
want to upgrade yet you should stay with version 0.6.0, the last one before the
upgrade.**

Starting it up
--------------

```javascript
var ftp = require("jsftp");

// The constructor accepts the parameters `host`, `port`, `user` and `pass`.
// `port` defaults to `21`.
var myFtp = new ftp({
  host: "myserver.com",
  user: "user", // defaults to "anonymous"
  pass: "1234" // defaults to "@anonymous"
};
```

jsftp gives you access to all the raw commands of the FTP protocol in form of
methods in the `Ftp` object. It also provides several convenience methods for
actions that require complex chains of commands (e.g. uploading and retrieving
files, passive operations).

When commands succeed they always pass the response of the server to the
callback, in the form of an object that contains two properties: `code`, which
is the response code of the FTP operation, and `text`, which is the complete
text of the response.

Raw (or native) commands are accessible in the form `Ftp.raw["desired_command"](params, callback)`

Thus, a command like `QUIT` will be called like this:

```javascript
Ftp.raw.quit(function(err, data) {
    if (err) return console.error(err);

    console.log("Bye!");
});
```

and a command like `MKD` (make directory), which accepts parameters, looks like this:

```javascript
Ftp.raw.mkd("/new_dir", function(err, data) {
    if (err) return console.error(err);

    console.log(data.text); // Presenting the FTP response text to the user
    console.log(data.code); // Presenting the FTP response code to the user
});
```

Common usage examples
--------------

```javascript

// Create a directory
ftp.raw.mkd("/example_dir", function(err, data) {
    if (err) return console.error(err);

    console.log(data.text);
});

// Delete a directory
ftp.raw.rmd("/example_dir", function(err, data) {
    if (err) return console.error(err);

    console.log(data.text);
});

// Listing a directory
ftp.ls("/example_dir", function(err, files){
    if (err) return console.error(err);
    console.log(files); // Contains an array of file objects
});

// Retrieving a file using streams
ftp.getGetSocket("/test_dir/testfile.txt"), function(err, readable) {
    if (err) return console.error(err);

    var pieces = [];
    // `readable` is a stream, so we can attach events to it now
    readable.on("data", function(p) { pieces.push(p); });
    readable.on("close", function(err) {
        if (err) return console.error(new Error("readable connection error"));

        // `Ftp._concat` is an internal method used to concatenate buffers, it
        // is used here only for illustration purposes.
        console.log(Ftp._concat(pieces)); // print the contents of the file
    });

    // The readable stream is already paused, we have to resume it so it can
    // start streaming.
    readable.resume();
});

// Storing a file in the FTP server, using streams
var originalData = Fs.createReadStream("sourceFile.txt"));
originalData.pause();

ftp.getPutSocket("/remote_folder/sourceFileCopy.txt"), function(err, socket) {
    if (err) return console.error(err);
    originalData.pipe(socket); // Transfer from source to the remote file
    originalData.resume();
});
```

You can find more usage examples in the [unit tests](https://github.com/sergi/jsftp/blob/master/test/jsftp_test.js). This documentation
will grow as jsftp evolves.


API and examples
----------------

### Properties

#### Ftp.host

Host name for the current FTP server.

#### Ftp.port

Port number for the current FTP server (defaults to 21).

#### Ftp.socket

NodeJS socket for the current FTP server.

#### Ftp.features

Array of feature names for the current FTP server. It is
generated when the user authenticates with the `auth` method.

#### Ftp.system

Contains the system identification string for the remote FTP server.


### Methods

#### Ftp.raw.FTP_COMMAND([params], callback)
All the standard FTP commands are available under the `raw` namespace. These
commands might accept parameters or not, but they always accept a callback
with the signature `err, data`, in which `err` is the error response coming
from the server (usually a 4xx or 5xx error code) and the data is an object
that contains two properties: `code` and `text`. `code` is an integer indicating
the response code of the response and `text` is the response string itself.

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
ftp.ls(".", function(err, res) {
  res.forEach(function(file) {
    console.log(file.name);
  });
});
```

#### Ftp.list(filePath, callback)
Lists `filePath` contents using a passive connection. Calls callback with an
array of strings with complete file information.

```javascript
ftp.list(remoteCWD, function(err, res) {
  res.forEach(function(file) {
    console.log(file.name);
  });
  // Prints something like
  // -rw-r--r--   1 sergi    staff           4 Jun 03 09:32 testfile1.txt
  // -rw-r--r--   1 sergi    staff           4 Jun 03 09:31 testfile2.txt
  // -rw-r--r--   1 sergi    staff           0 May 29 13:05 testfile3.txt
  // ...
});
```

#### Ftp.get(remotePath, callback)
Gives back a paused socket with the file contents ready to be streamed,
or calls the callback with an error if not successful.

```javascript
  var str = ""; // We will store the contents of the file in this string
  ftp.get('remote/path/file.txt', function(err, socket) {
    if (err) return;

    socket.on("data", function(d) { str += d.toString(); })
    socket.on("close", function(hadErr) {
      if (hadErr)
        console.error('There was an error retrieving the file.');
    });
    socket.resume();
  });
```

#### Ftp.get(remotePath, localPath, callback)
Stores the remote file directly in the given local path.

```javascript
  ftp.get('remote/file.txt, 'local/file.txt, function(hadErr) {
    if (hadErr)
      console.error('There was an error retrieving the file.');
    else
      console.log('File copied successfully!');
  });
```

#### Ftp.put(source, remotePath, callback)
Uploads a file to `filePath`. It accepts a string with the local path for the
file or a `Buffer` as a `source` parameter.

```javascript
ftp.put(buffer, 'path/to/remote/file.txt', function(hadError) {
  if (!hadError)
    console.log("File transferred successfully!");
});
```

#### Ftp.rename(from, to, callback)
Renames a file in the server. `from` and `to` are both filepaths.


#### Ftp.keepAlive()
Refreshes the interval thats keep the server connection active. There is no
need to call this method since it is taken care internally

Installation
------------

With NPM:

    npm install jsftp

From GitHub:

    git clone https://github.com/sergi/jsftp.git


Test coverage
-------------

Overall coverage rate (v1.0.0):
  lines......: 86.8% (342 of 394 lines)
  functions..: 88.4% (76 of 86 functions)


Tests
-----

To run the tests:

    npm install --dev
    npm test

Changelog
---------

**1.0.0**
- Big refactoring and rewriting, better use of streams.

**0.5.8**
- Fixed bad filename parsing on some cases

**0.5.7**
- Fixed bug when parsing truncated file listings

**0.5.6**
- Fixed bug in which passive requests would ignore the host if it was not the
  same as the original host.

**0.5.5**
- Solved issues and hangs when uploading big files


License
-------

See LICENSE.
