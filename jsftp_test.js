var Ftp = require("./jsftp");
// Fire it up. For test purposes only!
var ftp = new Ftp({
    port: 21,
    host: "sergimansilla.com",
    user: "mrclash",
    pass: "ketu48"
});

ftp.stat("/");
ftp.pwd();
ftp.setBinary(true);

setTimeout(function(){ftp.quit();}, 5000);
