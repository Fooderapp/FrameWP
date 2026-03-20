const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== 'false',
    executablePath:
      process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });

  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });

  const resolveActiveEditorPage = async () => {
    const pages = browser.contexts()[0]?.pages?.() ?? [];
    const livePages = pages.filter((candidate) => !candidate.isClosed());
    return livePages.find((candidate) => candidate.url().includes('page=framebuilder')) || livePages[livePages.length - 1] || page;
  };

  page.on('console', (msg) => {
    console.log(`BROWSER ${msg.type().toUpperCase()}: ${msg.text()}`);
  });

  await page.goto('http://canvaswp.local/wp-login.php', { waitUntil: 'domcontentloaded' });
  await page.fill('#user_login', process.env.WP_USER || 'admin');
  await page.fill('#user_pass', process.env.WP_PASS || 'admin');
  await page.click('#wp-submit');
  await page.waitForURL(/\/wp-admin\/?/);

  console.log('AFTER_LOGIN_URL', page.url());

  await page.goto('http://canvaswp.local/wp-admin/admin.php?page=framebuilder&post_id=5', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => !!document.querySelector('.fb-el[data-id]'), { timeout: 30000 });
  await page.waitForTimeout(800);

  const editorPage = await resolveActiveEditorPage();

  const authCloseButton = editorPage.locator('.wp-auth-check-close');
  if (await authCloseButton.count()) {
    await authCloseButton.first().click().catch(() => {});
  }

  console.log('EDITOR_URL', editorPage.url());

  const readSelectionState = () => editorPage.evaluate(() => {
    const editable = document.querySelector('[data-rich-text-editor-ui="true"][contenteditable="true"]');
    const toolbar = document.querySelector('.fb-inline-text-toolbar');
    const popover = document.querySelector('.fb-inline-style-dropdown__popover');
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return {
        editable: !!editable,
        toolbar: !!toolbar,
        popover: !!popover,
        selectedText: '',
        collapsed: true,
        inlineFontSize: '',
        computedFontSize: '',
      };
    }
    const range = selection.getRangeAt(0);
    let element = range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer;
    let inlineFontSize = '';
    let computedFontSize = '';
    let computedColor = '';
    let editableTextAlign = '';
    let inlineFontFamily = '';
    let computedFontFamily = '';
    while (element && element instanceof Element) {
      if (element.style?.fontSize) {
        inlineFontSize = element.style.fontSize;
      }
      if (!inlineFontFamily && element.style?.fontFamily) {
        inlineFontFamily = element.style.fontFamily;
      }
      if (element === editable) break;
      element = element.parentElement;
    }
    const computedElement = range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer;
    if (computedElement instanceof Element) {
      computedFontSize = window.getComputedStyle(computedElement).fontSize;
      computedColor = window.getComputedStyle(computedElement).color;
      computedFontFamily = window.getComputedStyle(computedElement).fontFamily;
    }
    if (editable instanceof Element) {
      editableTextAlign = window.getComputedStyle(editable).textAlign;
    }
    return {
      editable: !!editable,
      toolbar: !!toolbar,
      popover: !!popover,
      selectedText: selection.toString(),
      collapsed: selection.isCollapsed,
      anchorOffset: selection.anchorOffset,
      focusOffset: selection.focusOffset,
      inlineFontSize,
      inlineFontFamily,
      computedFontSize,
      computedFontFamily,
      computedColor,
      editableTextAlign,
    };
  });

  const targetId = await editorPage.evaluate(() => {
    return Array.from(document.querySelectorAll('.fb-el[data-id]'))
      .map((node) => {
        const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
        const rect = node.getBoundingClientRect();
        return {
          id: node.getAttribute('data-id') || '',
          className: node.className || '',
          text,
          area: rect.width * rect.height,
          width: rect.width,
          height: rect.height,
        };
      })
      .filter((node) => (
        !node.className.includes('fb-el--flow')
        && node.text
        && node.text !== 'Text'
        && node.text !== 'VIDEO'
        && node.width > 40
        && node.height > 10
      ))
      .sort((a, b) => a.area - b.area)[0]?.id || null;
  });

  if (!targetId) {
    throw new Error('Could not find target text element for inline editor test');
  }

  console.log('TARGET_TEXT_ID', targetId);

  const target = editorPage.locator(`.fb-el[data-id="${targetId}"]`).first();
  await target.scrollIntoViewIfNeeded();
  await target.dblclick();
  await editorPage.waitForFunction(() => !!document.querySelector('[data-rich-text-editor-ui="true"][contenteditable="true"]'));

  await editorPage.evaluate(() => {
    const editable = document.querySelector('[data-rich-text-editor-ui="true"][contenteditable="true"]');
    if (!editable) return;
    const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
    const textNode = walker.nextNode();
    if (!textNode || !textNode.textContent) return;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(7, textNode.textContent.length));
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  const afterOpen = await readSelectionState();
  console.log('AFTER_OPEN', JSON.stringify(afterOpen));

  await editorPage.waitForFunction(() => {
    const toolbar = document.querySelector('.fb-inline-text-toolbar');
    const selection = window.getSelection();
    return !!toolbar && !!selection && !selection.isCollapsed && selection.toString().length > 0;
  });

  const beforeDropdown = await readSelectionState();
  console.log('BEFORE_DROPDOWN', JSON.stringify(beforeDropdown));

  const fontTrigger = editorPage.locator('.fb-inline-text-toolbar__font-picker .fb-font-picker__trigger').first();
  await fontTrigger.click();
  await editorPage.waitForFunction(() => !!document.querySelector('.fb-font-picker__popover'));
  const beforeFontPreview = await readSelectionState();
  console.log('BEFORE_FONT_PREVIEW', JSON.stringify(beforeFontPreview));
  const previewFontName = beforeFontPreview.computedFontFamily.toLowerCase().includes('roboto') ? 'Open Sans' : 'Roboto';
  const fontOption = editorPage.locator('.fb-font-picker__popover .fb-font-picker__option', { hasText: previewFontName }).first();
  await fontOption.hover();
  await editorPage.waitForTimeout(350);
  const afterFontPreview = await readSelectionState();
  console.log('AFTER_FONT_PREVIEW', JSON.stringify(afterFontPreview));
  await editorPage.locator('.fb-font-picker__popover').hover({ position: { x: 12, y: 12 } }).catch(() => {});
  await editorPage.mouse.move(20, 20);
  await editorPage.waitForTimeout(200);
  const afterFontPreviewReset = await readSelectionState();
  console.log('AFTER_FONT_PREVIEW_RESET', JSON.stringify(afterFontPreviewReset));
  await fontOption.click();
  await editorPage.waitForTimeout(300);
  const afterFontCommit = await readSelectionState();
  console.log('AFTER_FONT_COMMIT', JSON.stringify(afterFontCommit));

  const fontSizeWrap = editorPage.locator('.fb-inline-text-toolbar .fb-inline-text-toolbar__select-wrap').first();
  await fontSizeWrap.locator('.fb-inline-style-dropdown__toggle').click();
  await editorPage.waitForFunction(() => !!document.querySelector('.fb-inline-style-dropdown__popover'));

  const option32 = editorPage.locator('.fb-inline-style-dropdown__popover .fb-inline-style-dropdown__option', { hasText: '32px' }).first();
  await option32.hover();
  await editorPage.waitForTimeout(200);
  const afterHover32 = await readSelectionState();
  console.log('AFTER_HOVER_32', JSON.stringify(afterHover32));

  const option48 = editorPage.locator('.fb-inline-style-dropdown__popover .fb-inline-style-dropdown__option', { hasText: '48px' }).first();
  await option48.hover();
  await editorPage.waitForTimeout(200);
  const afterHover48 = await readSelectionState();
  console.log('AFTER_HOVER_48', JSON.stringify(afterHover48));

  await option48.click();
  await editorPage.waitForTimeout(200);
  const afterCommit48 = await readSelectionState();
  console.log('AFTER_COMMIT_48', JSON.stringify(afterCommit48));

  await editorPage.locator('.fb-inline-text-toolbar__group--align button[aria-label="Align center"]').click();
  await editorPage.waitForTimeout(200);
  const afterAlignCenter = await readSelectionState();
  console.log('AFTER_ALIGN_CENTER', JSON.stringify(afterAlignCenter));

  await editorPage.locator('.fb-inline-text-toolbar__color .fb-fill-swatch').click();
  await editorPage.waitForFunction(() => !!document.querySelector('.fb-fill-popover'));
  const satValSquare = editorPage.locator('[data-fill-picker-target="satval"]').first();
  const squareBox = await satValSquare.boundingBox();
  if (!squareBox) throw new Error('Could not find visual color square');
  await satValSquare.click({ position: { x: Math.max(8, squareBox.width - 20), y: 18 } });
  await editorPage.waitForTimeout(250);
  const afterColorCommit = await readSelectionState();
  console.log('AFTER_COLOR_COMMIT', JSON.stringify(afterColorCommit));

  const regressionPassed = [afterOpen, afterFontPreview, afterFontPreviewReset, afterFontCommit, afterHover32, afterHover48, afterCommit48, afterAlignCenter, afterColorCommit].every((state) => (
    state.editable
    && state.toolbar
    && state.selectedText.length > 0
    && !state.collapsed
  ))
    && afterOpen.selectedText !== 'Text'
    && afterFontPreview.computedFontFamily !== beforeFontPreview.computedFontFamily
    && afterFontPreviewReset.computedFontFamily === beforeFontPreview.computedFontFamily
    && afterFontCommit.computedFontFamily !== beforeFontPreview.computedFontFamily
    && afterCommit48.inlineFontSize === '48px'
    && afterCommit48.computedFontSize === '48px'
    && afterAlignCenter.editableTextAlign === 'center'
    && !/rgb\(0,\s*0,\s*0\)/i.test(afterColorCommit.computedColor);

  console.log('REGRESSION_PASSED', regressionPassed);

  if (!regressionPassed) {
    throw new Error('Rich text editor regression failed for font size, alignment, or color application');
  }

  await editorPage.screenshot({ path: 'tmp-framebuilder-editor.png', fullPage: true });
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});