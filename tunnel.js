const { tunnelmole } = require('tunnelmole');

(async () => {
  try {
    console.log('Starting tunnelmole on port 3000...');
    const url = await tunnelmole({
      port: 3000
    });

    console.log('=========================================');
    console.log('YOUR SECURE MOBILE URL IS:');
    console.log(url);
    console.log('=========================================');

    // Keep process alive
    process.stdin.resume();
  } catch (err) {
    console.error('Error starting tunnelmole:', err);
    process.exit(1);
  }
})();
