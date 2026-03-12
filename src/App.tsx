import { useState } from 'react';
import { ReaderPanel } from './components/LeftReader/ReaderPanel';
import { InteractionPanel } from './components/RightFocus/InteractionPanel';
import type { ActiveItemInfo } from './types';
import './App.css';

function App() {
  const [activeItem, setActiveItem] = useState<ActiveItemInfo | null>(null);

  const handleItemClick = (item: ActiveItemInfo) => {
    setActiveItem(item);
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="logo">
          🌟 <span>English Reader</span>
        </div>
        <p className="welcome-text">上传英语课文 PDF，点击文字即可发音！</p>
      </header>

      {/* Main Split Layout */}
      <main className="main-content">
        <section className="left-column">
          <ReaderPanel
            activeItem={activeItem}
            onItemClick={handleItemClick}
          />
        </section>
        <section className="right-column">
          <InteractionPanel
            activeItem={activeItem}
          />
        </section>
      </main>
    </div>
  );
}

export default App;
