const ChildProcess = require('child_process');

function sleep (time) {
  return new Promise((resolve) => {
    const sto = setTimeout(() => {
      clearTimeout(sto);
      resolve();
    }, time);
  });
}

function run () {
  let invoked = false;
  const process = ChildProcess.fork(`${__dirname}/update.js`);
  process.on('exit', async () => {
    if (invoked) return;
    invoked = true;
    await sleep(10000);
    run();
  });
}

run();
