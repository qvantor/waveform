import React from 'react';
import styled from 'styled-components';
import { theme } from '../common/constants';

interface TabProps {
  id: string;
  name?: React.ReactNode;
}

const Tab = ({ children }: React.PropsWithChildren<TabProps>): JSX.Element => children as JSX.Element;

export const isTab = (
  element: React.ReactFragment | React.ReactPortal | React.ReactElement<unknown> | string | number
): element is React.ReactElement<TabProps> => React.isValidElement(element) && element.type === Tab;

interface Props {
  activeTab: string;
  onSelect?: (name: string) => void;
}

const TabsContainer = styled.div`
  display: flex;
  flex-direction: column;
  border-right: 1px solid ${theme.colors.primaryLowContrast};
`;

const TabItem = styled.div<{ active: boolean }>`
  width: 49px;
  height: 49px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid ${theme.colors.primaryLowContrast};
  color: ${({ active }) => (active ? theme.colors.secondAccent : theme.colors.primaryDark)};
  box-shadow: ${({ active }) => (active ? 'inset 0 0 15px 0 rgba(0,0,0,0.15)' : 'none')};
  transition: all 150ms;
  cursor: pointer;

  &:hover {
    background: ${theme.colors.primaryLowContrast};
    color: ${theme.colors.white};
  }
`;

export const Tabs = ({ children, activeTab, onSelect }: React.PropsWithChildren<Props>) => {
  const tabs = React.useMemo(
    () =>
      React.Children.toArray(children)
        .filter(isTab)
        .map((element) => ({
          ...element.props,
          name: element.props.name ?? element.props.id,
          element,
        })),
    [children]
  );

  const currentTab = React.useMemo(() => tabs.find((tab) => tab.id === activeTab), [activeTab, tabs]);

  return (
    <>
      <TabsContainer>
        {tabs.map((tab) => (
          <TabItem active={tab.id === activeTab} key={tab.id} onClick={() => onSelect?.(tab.id)}>
            {tab.name}
          </TabItem>
        ))}
      </TabsContainer>
      {currentTab && currentTab.element}
    </>
  );
};

Tabs.Tab = Tab;
