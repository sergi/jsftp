jsftp
=====

jsftp is a client FTP module for NodeJS that focuses on correctness, clarity and conciseness. It doesn't get in the middle of the user intentions.

jsftp gives the user access to all the raw commands of FTP in form of methods in the `Ftp` object. It also provides several convenience methods for actions that require complex chains of commands (e.g. uploading and retrieving files). When commands succeed they always pass the response of the server to the callback, in the form of an object that contains two properties: `code`, which is the response code of the FTP operation, and `text`, which is the complete text of the response.

Raw (or native) commands are accessible in the form `Ftp.raw["desired_command"](params, callback)`

Thus, a command like `QUIT` will be called like

```javascript
Ftp.raw.quit(function(err, data) {
    if (err)
        throw err;

    console.log("Bye!");
});
```

and a command like `MKD`, which accepts parameters, will look like

```javascript
Ftp.raw.mkd("/new_dir", function(err, data) {
    if (err)
        throw err;

    console.log(data.text); // Presenting the FTP response text to the user
});
```


Usage examples
--------------

```javascript
// Initialize some common variables
var user = "johndoe";
var pass = "12345";

var ftp = new Ftp({
    host: "myhost.com",
    port: 21, // The port defaults to 21, but let's include it anyway.
});


// First, we authenticate the user
ftp.auth(user, pass, function(err, res) {
    if (err) throw err;

    // Retrieve a file in the remote server. When the file has been retrieved,
    // the callback will be called with `data` being the Buffer with the
    // contents of the file.

    // This is a convenience method that hides the actual complexity of setting
    // up passive mode and retrieving files.

    ftp.get("/folder/file.ext", function(err, data) {
        if (err) throw err;

        // Do something with the buffer
        doSomething(data);

        // We can use raw FTP commands directly as well. In this case we use FTP
        // 'QUIT' method, which accepts no parameters and returns the farewell
        // message from the server
        ftp.raw.quit(function(err, res) {
            if (err) throw err;

            console.log("FTP session finalized! See you soon!");
        });
    });
});

// The following code assumes that you have authenticated the user, just like
// I did in the code above.

// Create a directory
ftp.raw.mkd("/example_dir", function(err, data) {
    if (err)
        throw err;

    console.log(data.text);
});

// Delete a directory
ftp.raw.rmd("/example_dir", function(err, data) {
    if (err)
        throw err;

    console.log(data.text);
});
```

You can find more usage examples in the unit tests for it. This documentation
will grow as jsftp evolves, I promise!


API
---

### Properties

#### Ftp.host

Host name for the current FTP server.

#### Ftp.port

Port number for the current FTP server (defaults to 21).

#### Ftp.socket

NodeJS socket for the current FTP server.

#### Ftp.dataConn

NodeJS socket for the current passive connection, if any.

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
the response code of the response and `text` is the response stgring itself.

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
Lists information about files or directories and yields an array of file objects with parsed file properties to the callback. You should use this function instead of `stat` or `list` in case you need to do something with the individual files properties.

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

The test script fires up by default the FTP server that comes with OSX. You
will have to put your OSX user credentials in `jsftp_test.js` if you want to
run it. If you are not on OSX, feel free to change the FTP host, port and
credentials to point to a remote server.

To run the tests in the command line:

    node jsftp_test.js

If tests are failing it might be that your user doesn't have enough rights to
run the FTP service. In that case you should run the tests as `sudo`:

    sudo node jsftp_test.js

Please note that running scripts as sudo is dangerous and you will grant the
script to do anything in your server. You should do it at your own risk.


License
-------

See LICENSE.

