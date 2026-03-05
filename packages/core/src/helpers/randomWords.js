// this is a module containing some ready made functions to generate random words
// to use it do the following in file.js
/*
//at the bottom of the file, add the following in the module.exports object:
dependencies: {
    randomizer: 'module:helpers/randomWords',
  },

//inside the implementation function
  const { randomizer: { Randomizer } } = dependencies;

  // you can now use any of the function like that
  Randomizer.function()

*/

module.exports.Randomizer = class {
  static maxWordCount = 24;

  static minWordCount = 4;

  static skewWordCount = 0.9;

  static boxMuller(minimum, maximum, skewness) {
    const min = minimum || this.minWordCount;
    const max = maximum || this.maxWordCount;
    const skew = skewness || this.skewWordCount;
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random(); // Converting [0,1) to (0,1)
    while (v === 0) v = Math.random();
    let num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);

    num = num / 10.0 + 0.5; // Translate to 0 -> 1
    if (num > 1 || num < 0) num = this.boxMuller(); // resample between 0 and 1 if out of range
    else {
      num **= skew; // Skew
      num *= max - min; // Stretch to fill range
      num += min; // offset to min
    }
    return Math.floor(num);
  }

  // Utility function to find index of {random} in array[start..end]
  static findRandomInPrefixArray(arr, random, start, end) {
    let newStart = start;
    let newEnd = end;
    let mid;
    while (newStart < newEnd) {
      mid = Math.floor((newStart + newEnd) / 2);
      if (random > arr[mid]) {
        newStart = mid + 1;
      } else {
        newEnd = mid;
      }
    }
    return (arr[newStart] >= random) ? newStart : -1;
  }

  // Utility which returns a random item from array[]
  // according to distribution array defined by frequency[].
  static getWord = (array, cumul) => {
    const size = array.length;

    // Generate a random number with
    // value from 1 to the max sum
    const random = this.boxMuller(0, cumul[size - 1], 0);

    // Find index of {random} in cumul array
    const index = this.findRandomInPrefixArray(cumul, random, 0, size - 1);
    return array[index];
  };

  static generateSlug(wordObj) {
    const randomWordCount = this.boxMuller();
    const strn = [...Array(randomWordCount - 1).fill('-'), ''];
    return strn.reduce((acc, delim) => `${acc}${this.getWord(wordObj.list, wordObj.cumulFrequency)}${delim}`, '');
  }
};
