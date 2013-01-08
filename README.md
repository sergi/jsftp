jsftp [![Build Status](https://secure.travis-ci.org/sergi/jsftp.png)](http://travis-ci.org/sergi/jsftp)
=====

jsftp is a client FTP library for NodeJS that focuses on correctness, clarity and conciseness. It doesn't get in the middle of the user intentions, and plays nice with streaming APIs.

jsftp gives the user access to all the raw commands of FTP in form of methods in the `Ftp` object. It also provides several convenience methods for actions that require complex chains of commands (e.g. uploading and retrieving files). When commands succeed they always pass the response of the server to the callback, in the form of an object that contains two properties: `code`, which is the response code of the FTP operation, and `text`, which is the complete text of the response.

Raw (or native) commands are accessible in the form `Ftp.raw["desired_command"](params, callback)`

Thus, a command like `QUIT` will be called like

```javascript
Ftp.raw.quit(function(err, data) {
    if (err) return console.error(err);

    console.log("Bye!");
});
```

and a command like `MKD`, which accepts parameters, will look like

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
var Ftp = require("jsftp");

var ftp = new Ftp({
    host: "myhost.com",
    user: "johndoe",
    port: 3334, // Defaults to 21
    pass: "12345"
});


// Retrieve a file in the remote server. When the file has been retrieved,
// the callback will be called with `data` being the Buffer with the
// contents of the file.

// `ftp.get` is a convenience method. In this case, it hides the actual
// complexity of setting up passive mode and retrieving files. Keep in mind that
// this will buffer the contents of the file in memory before transmitting them. For a streaming, non-buffering solution please use `getGetSocket`.
ftp.get("/folder/file.ext", function(err, data) {
    if (err)
        return console.error(err);

    // Do something with the buffer
    doSomething(data);

    // We can use raw FTP commands directly as well. In this case we use FTP
    // 'QUIT' method, which accepts no parameters and returns the farewell
    // message from the server
    ftp.raw.quit(function(err, res) {
        if (err)
            return console.error(err);

        console.log("FTP session finalized! See you soon!");
    });
});

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


API
---

### Properties

#### Ftp.host

Host name for the current FTP server.

#### Ftp.port

Port number for the current FTP server (defaults to 21).

#### Ftp.socket

NodeJS socket for the current FTP server.

#### Ftp.features

`features` is an array of feature names for the current FTP server. It is
generated when the user authenticates with the `auth` method.


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

#### Ftp.list(filePath, callback)
Lists `filePath` contents using a passive connection.

#### Ftp.get(filePath, callback)
Downloads `filePath` from the server.

#### Ftp.put(filePath, buffer, callback)
Uploads a file to `filePath`. It accepts a `buffer` parameter that will be
written in the remote file.

#### Ftp.rename(from, to, callback)
Renames a file in the server. `from` and `to` are both filepaths.

#### Ftp.ls(filePath, callback)
Lists information about files or directories and yields an array of file objects with parsed file properties to the callback. You should use this function instead of `stat` or `list` in case you need to do something with the individual file properties.

#### Ftp.keepAlive()
Refreshes the interval thats keep the server connection active. There is no
need to call this method since it is taken care internally


Installation
------------

With NPM:

    npm install jsftp

From GitHub:

    git clone https://github.com/sergi/jsftp.git


Tests
-----

To run the tests:

    npm test

Please note that for now the unit tests require python because the FTP server
used is written in python.

Changelog
---------

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
