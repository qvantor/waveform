import { ConfigProvider } from 'antd';
import { StyleSheetManager } from 'styled-components';
import { App } from './app';
import Synth from './synth';

export function Core() {
  // the vendor prefixes of the CSS, which styled-components added before v6 (it adds none by default since)
  return (
    <StyleSheetManager enableVendorPrefixes>
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
    </StyleSheetManager>
  );
}
