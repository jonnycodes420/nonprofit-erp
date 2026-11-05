// SPLIT-2: server.js is the entry. Its statements moved VERBATIM to server/boot/: the
// functions to helpers-N.js, loaded first, and every other statement to steps-N.js, run in the
// order server.js ran them (route order and middleware order unchanged). See server/boot/share.js.
// Tests read the whole as readSource("server.js").
const __boot = require("./server/boot/share");
require("./server/boot/helpers-1.js");
require("./server/boot/helpers-2.js");
require("./server/boot/helpers-3.js");
require("./server/boot/helpers-4.js");
require("./server/boot/helpers-5.js");
require("./server/boot/helpers-6.js");
require("./server/boot/helpers-7.js");
require("./server/boot/helpers-8.js");
require("./server/boot/helpers-9.js");
require("./server/boot/steps-1.js");
require("./server/boot/steps-2.js");
require("./server/boot/steps-3.js");
require("./server/boot/steps-4.js");
const { app } = __boot.ctx;
// SPLIT-2 server.js piece 806
module.exports = app;
// SPLIT-2 end
