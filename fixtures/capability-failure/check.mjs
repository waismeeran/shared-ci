const capability = process.argv[2];
if (capability === 'lint') {
  console.error('intentional lint failure for hosted validation');
  process.exit(1);
}
console.log(`capability ${capability} passed`);
