import { ConfigProvider } from 'antd';
import { App } from './app';
import Synth from './synth';

export function Core() {
  return (
    <ConfigProvider
      theme={{
        token: {
          borderRadius: 0,
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          sizePopupArrow: 0,
          boxShadowSecondary: '',
        },
      }}
    >
      <App>
        <Synth />
      </App>
    </ConfigProvider>
  );
}

export default Core;
