import { installCanvasStub } from './common/test-utils/canvas';

// jsdom has no 2D context: the live charts and the marks draw on a recording stub
installCanvasStub();
