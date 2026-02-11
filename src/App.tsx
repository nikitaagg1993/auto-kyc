import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import CameraView from './components/CameraView';

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
  },
});

function App() {
  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <CameraView />
    </ThemeProvider>
  );
}

export default App;
