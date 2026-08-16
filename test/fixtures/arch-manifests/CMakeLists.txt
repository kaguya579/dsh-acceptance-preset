cmake_minimum_required(VERSION 3.16)
project(sample C)

find_package(Threads REQUIRED)

add_subdirectory(lib)

add_executable(app main.c)
target_link_libraries(app PRIVATE Threads::Threads)
