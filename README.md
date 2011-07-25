jsFTP
=====

jsFTP is a client FTP module for NodeJS that focuses on correctness, clarity and conciseness. It doesn't get in the middle of the user intentions.

jsFTP gives the user access to all the raw commands of FTP in form of methods in the `Ftp` object. It also provides several convenience methods for actions that require complex chains of commands (e.g. uploading and retrieving files). When commands succeed they always pass the response of the FTP server to the callback, in the form of an object that contains two properties: `code`, which is the response code of the FTP operation, and `text`, which is the complete text of the response.

FTP raw (or native) commands are accessible in the form `Ftp.raw["desired_command"](params, callback)`

Thus, a command like `QUIT` will be called like

    Ftp.raw.quit(function(err, data) {
        if (err)
            throw err;

        console.log("Bye!");
    });

and a command like `MKD`, which accepts parameters will look like

    Ftp.raw.mkd("/new_dir", function(err, data) {
        if (err)
            throw err;

        console.log(data.text); // Presenting the FTP response text to the user
    });


Usage examples
--------------

```javascript
// Initialize some common variables
var user = "johndoe";
var pass = "12345"

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
ftp.raw.mkd("/example_dir", function(err, res) {
    if (err) throw err;

    console.log(data.text);
});

// Delete a directory
ftp.raw.rmd("/example_dir", function(err, res) {
    if (err) throw err;

    console.log(data.text);
});
```

You can find more usage examples in the unit tests for it. This documentation
will grow as jsFTP evolves, I promise!

API
---

### Properties

#### Ftp.host

Host name for the current FTP server.

#### Ftp.port

Port number for the current FTP server (defaults to 21).

#### Ftp.socket

NodeJS socket for the current FTP server.

### Ftp.dataConn

NodeJS socket for the current passive connection, if any.

#### Ftp.features

`features` is an array of feature names for the current FTP server. It is
generated when the user authenticates with the `auth` method.

Installation
------------

With NPM:

    npm install jsftp

From GitHub:

    git clone https://github.com/sergi/jsFTP.git

License
-------

See LICENSE.

