// 云端 C++ 诊断模块样例（静态分析测试用）
#include "sample.hpp"

struct Config;
class DiagEngine;

struct Limit {
    uint16_t max;
};

class DiagEngine {
public:
    void start() {}
};

int init() {
    return 0;
}

uint16_t Config::get_code() const {
    return code;
}
