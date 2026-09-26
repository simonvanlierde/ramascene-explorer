def pytest_addoption(parser):
    parser.addoption("--engine", default=None, help="RaMa-Scene checkout: run tests/test_engine_plumbing.py against it")
