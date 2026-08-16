#include <stdio.h>

// 超长函数 fixture：行数 > 80（注释行计入函数行范围），圈复杂度低。
int long_func(void) {
  int x = 0;
  // pad 01
  // pad 02
  // pad 03
  // pad 04
  // pad 05
  // pad 06
  // pad 07
  // pad 08
  // pad 09
  // pad 10
  // pad 11
  // pad 12
  // pad 13
  // pad 14
  // pad 15
  // pad 16
  // pad 17
  // pad 18
  // pad 19
  // pad 20
  // pad 21
  // pad 22
  // pad 23
  // pad 24
  // pad 25
  // pad 26
  // pad 27
  // pad 28
  // pad 29
  // pad 30
  // pad 31
  // pad 32
  // pad 33
  // pad 34
  // pad 35
  // pad 36
  // pad 37
  // pad 38
  // pad 39
  // pad 40
  // pad 41
  // pad 42
  // pad 43
  // pad 44
  // pad 45
  // pad 46
  // pad 47
  // pad 48
  // pad 49
  // pad 50
  // pad 51
  // pad 52
  // pad 53
  // pad 54
  // pad 55
  // pad 56
  // pad 57
  // pad 58
  // pad 59
  // pad 60
  // pad 61
  // pad 62
  // pad 63
  // pad 64
  // pad 65
  // pad 66
  // pad 67
  // pad 68
  // pad 69
  // pad 70
  // pad 71
  // pad 72
  // pad 73
  // pad 74
  // pad 75
  // pad 76
  // pad 77
  // pad 78
  // pad 79
  // pad 80
  // pad 81
  // pad 82
  // pad 83
  // pad 84
  x = x + 1;
  return x;
}

// 高圈复杂度 fixture：16 个 if 决策点 → 圈复杂度 17（阈值 15）。
int complex_func(int a) {
  int r = 0;
  if (a == 1) r = 1;
  if (a == 2) r = 2;
  if (a == 3) r = 3;
  if (a == 4) r = 4;
  if (a == 5) r = 5;
  if (a == 6) r = 6;
  if (a == 7) r = 7;
  if (a == 8) r = 8;
  if (a == 9) r = 9;
  if (a == 10) r = 10;
  if (a == 11) r = 11;
  if (a == 12) r = 12;
  if (a == 13) r = 13;
  if (a == 14) r = 14;
  if (a == 15) r = 15;
  if (a == 16) r = 16;
  return r;
}
