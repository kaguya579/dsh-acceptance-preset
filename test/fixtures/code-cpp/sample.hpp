#pragma once

class Config {
public:
    uint16_t get_code() const;
    void set_code(uint16_t value);
private:
    uint16_t code;
};
