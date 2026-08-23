// 🐾 not linked from anywhere. `npm run treat` if you're curious.
const treats = [
  '🦉 the owl blinks once, slowly, in approval.',
  '🦦 the otter found a shiny rock and wants you to see it.',
  '🐢 the turtle has not moved in six hours and is thriving.',
  '🐘 the elephant remembers your first commit. all of them, actually.',
  '🐿️ the squirrel buried a snippet somewhere and is 70% sure it remembers where.',
  '🦡 the badger emerges from the burrow, covered in expired clipboard entries, victorious.',
  '🦥 the sloth has been "rate limiting" the same request for four days.',
];
console.log(treats[Math.floor(Math.random() * treats.length)]);
