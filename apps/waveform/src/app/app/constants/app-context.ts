import React from 'react';

import { appModule } from '../modules';

export const AppContext = React.createContext<ReturnType<typeof appModule> | null>(null);
