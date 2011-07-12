var Ftp = require("./jsftp");
// Fire it up. For test purposes only!
var ftp = new Ftp({
    port: 2021,
    host: "localhost",
    user: "sergi",
    pass: "2x8hebsndr9"
});




ftp.stat("/", function() {
    ftp.pwd(function(res) {
        console.log("All together now: ", res);
        ftp.type("A");
        ftp.syst();
        ftp.pwd();
        ftp.list("/")
    })
});
//ftp.setBinary(true);
setTimeout(function(){ ftp.quit(); }, 5000);
