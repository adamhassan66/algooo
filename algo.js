/*
*   Write a function that accepts an array of numbers
*   and returns an array of the number(s) that occur
*   the most.
*/

const mostFrequent = (nums) => {
  let count = {}
  let maxCount = 0
  let maxNum = [nums[0]]
  for( let i = 0; i < nums.length; i++){
      //if we haven't counted number yet, make a new entry
      if(count[nums[i]] === undefined){
          count[nums[i]] = 1
      }  else count[nums[i]] += 1
      //if we find a number with a higher count than maxCount,\
      //emtpy the maxNum array and start over w that number
      if(count[nums[i]] > maxCount){
          maxCount = count[nums[i]]
          maxNum = [nums[i]]
      }
      //if we find a number with the same count, 
      //add it to max array 
      else if(count[nums[i]] == maxCount){
          maxNum.push(nums[i])
      }
  } return maxNum
}

// should return [0]
console.log(mostFrequent([0, 0, 0, 2, 2, 3]));

// should return [0,1,2,3,4,5]
console.log(mostFrequent([0,1,2,3,4,5]));

// should return [5,2]
console.log(mostFrequent([5,8,2,4,0,15,16,90,5,1,5,23,42,0,6,2,8,2,5,2]));