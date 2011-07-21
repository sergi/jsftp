var assert = require("assert");
var Ftp = require("./jsftp");
var Fs = require("fs");
var exec = require('child_process').spawn;

var FTPCredentials = {
    host: "localhost",
    user: "sergi",
    port: 2021,
    pass: "2x8hebsndr9"
};

var CWD = process.cwd();

// Execution ORDER: test.setUpSuite, setUp, testFn, tearDown, test.tearDownSuite
module.exports = {
    timeout: 10000,

    setUp: function(next) {
        exec('/bin/launchctl', ['load', '-w', '/System/Library/LaunchDaemons/ftp.plist']);
        var self = this;
        setTimeout(function() {
            self.ftp = new Ftp(FTPCredentials);
            next();
        }, 200);
    },

    tearDown: function(next) {
        exec('/bin/launchctl', ['unload', '-w', '/System/Library/LaunchDaemons/ftp.plist']);
        this.ftp = null;
        next();
    },

    "test print working directory": function(next) {
        var self = this;
        this.ftp.auth(FTPCredentials.user, FTPCredentials.pass, function(res) {
            self.ftp.raw.pwd(function(res) {
                var code = parseInt(res.code, 10);
                assert.ok(code === 257, "PWD command was not successful");

                self.ftp.raw.quit(function(res) {
                    next();
                });
            });
        });
    },
    "test current working directory": function(next) {
        var ftp = this.ftp;
        ftp.auth(FTPCredentials.user, FTPCredentials.pass, function(res) {
            ftp.raw.cwd(CWD, function(res) {
                var code = parseInt(res.code, 10);
                assert.ok(code === 200 || code === 250, "CWD command was not successful");

                ftp.raw.pwd(function(res) {
                    var code = parseInt(res.code, 10);
                    assert.ok(code === 257, "PWD command was not successful");
                    assert.ok(res.text.indexOf(CWD), "Unexpected CWD");
                })

                ftp.raw.cwd("/unexistentDir/", function(res) {
                    code = parseInt(res.code, 10);
                    assert.ok(code === 550, "A (wrong) CWD command was successful. It should have failed");
                    next();
                });
            });
        });
    },
    "test passive listing of current directory": function(next) {
        var ftp = this.ftp;

        ftp.auth(FTPCredentials.user, FTPCredentials.pass, function(res) {
            ftp.list(CWD, function(err, res){
                console.log(res)
                next()
            })
        })

    }
};

!module.parent && require("./support/async/lib/test").testcase(module.exports, "FTP"/*, timeout*/).exec();
