// applied automatically to every app spec (node_modules mocks next to rootDir)
const toast = Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() });

export default toast;
