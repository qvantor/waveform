import React from 'react';
import cls from 'classnames';
import { CaretUpOutlined, CaretDownOutlined } from '@ant-design/icons';
import { styled } from 'styled-components';
import { theme } from '../common/constants';

// out of the line height: the row stays as high as its text
const Root = styled.div`
  display: flex;
  flex-direction: column;
  align-self: center;
  margin: -5px 0;
  transition: all 150ms;

  &.active {
    color: ${theme.colors.accent};
  }

  .up {
    margin-bottom: -2px;
  }

  .down {
    margin-top: -2px;
  }
`;

// a value that steps by whole numbers: up and down carets of the color of its text (a className may give them the
// one of its label), in the accent while it is held
export const StepArrows = ({ active, className }: { active: boolean; className?: string }) => (
  <Root className={cls(className, { active })}>
    <CaretUpOutlined className='up' />
    <CaretDownOutlined className='down' />
  </Root>
);
