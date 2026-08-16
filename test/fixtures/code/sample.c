/* 车端诊断模块样例（静态分析测试用） */
#include <stdint.h>

typedef struct {
    uint16_t code;
} Config;

int init(void) {
    return 0;
}

static int helper(int x) {
    return x + 1;
}
