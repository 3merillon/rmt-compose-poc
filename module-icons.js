document.addEventListener('DOMContentLoaded', function() {
  const iconsContainer = document.querySelector('.icons-container');
  if (!iconsContainer) return;
  
  iconsContainer.innerHTML = '';

  function createLabelIcon(text) {
    const labelIcon = document.createElement('div');
    labelIcon.style.height = '42px';
    labelIcon.style.display = 'flex';
    labelIcon.style.alignItems = 'center';
    labelIcon.style.justifyContent = 'center';
    labelIcon.style.border = '1px solid #ffa800';
    labelIcon.style.borderRadius = '4px';
    labelIcon.style.padding = '0 8px';
    labelIcon.style.textTransform = 'uppercase';
    labelIcon.style.fontFamily = "'Roboto Mono', monospace";
    labelIcon.style.color = '#ffa800';
    labelIcon.style.boxSizing = 'border-box';
    labelIcon.style.background = 'transparent';
    labelIcon.style.cursor = 'pointer';
    labelIcon.textContent = text + ' +';

    return labelIcon;
}

function handleFileUpload(category, sectionContainer) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.style.display = 'none';

  input.addEventListener('change', function(event) {
      const file = event.target.files[0];
      if (file) {
          const reader = new FileReader();
          reader.onload = function(e) {
              try {
                  const moduleData = JSON.parse(e.target.result);
                  const filename = file.name;
                  const icon = createModuleIcon(category, filename, moduleData);
                  sectionContainer.appendChild(icon);
              } catch (error) {
                  console.error("Error parsing JSON:", error);
                  alert("Invalid JSON file");
              }
          };
          reader.readAsText(file);
      }
  });

  document.body.appendChild(input);
  input.click();
  document.body.removeChild(input);
}

function createModuleIcon(category, filename, moduleData = null) {
  const moduleIcon = document.createElement('div');
  moduleIcon.classList.add('icon');
  moduleIcon.style.width = '42px';
  moduleIcon.style.height = '42px';
  moduleIcon.style.display = 'flex';
  moduleIcon.style.alignItems = 'center';
  moduleIcon.style.justifyContent = 'center';
  moduleIcon.style.fontFamily = "'Roboto Mono', monospace";
  moduleIcon.style.fontSize = '10px';
  moduleIcon.style.color = '#151525';
  moduleIcon.style.cursor = 'grab';
  moduleIcon.setAttribute('draggable', 'true');
  moduleIcon.style.touchAction = 'none';
  moduleIcon.style.overflow = 'hidden';
  moduleIcon.style.textOverflow = 'ellipsis';
  moduleIcon.style.whiteSpace = 'nowrap';

  const moduleName = filename.replace(/\.json$/i, '');
  moduleIcon.textContent = moduleName;
  moduleIcon.title = moduleName;

  if (moduleData) {
      moduleIcon.moduleData = moduleData;
  } else {
      const url = 'modules/' + category + '/' + filename;
      fetch(url)
          .then(response => {
              if (!response.ok) throw new Error('Network response not ok for ' + filename);
              return response.json();
          })
          .then(data => {
              moduleIcon.moduleData = data;
          })
          .catch(err => {
              console.error("Error loading moduleData for", filename, err);
          });
  }

  moduleIcon.addEventListener('dragstart', function(event) {
      if (moduleIcon.moduleData) {
          const jsonData = JSON.stringify(moduleIcon.moduleData);
          event.dataTransfer.setData('application/json', jsonData);
          event.dataTransfer.setData('text/plain', jsonData);
      }
      event.dataTransfer.effectAllowed = 'copy';
  });

  // Mobile pointer events.
  let ghost = null;
  let dragStarted = false;
  let startX = 0, startY = 0;
  const DRAG_THRESHOLD = 5;
  
  moduleIcon.addEventListener('pointerdown', function(e) {
      if (e.pointerType !== 'touch') return;
      e.preventDefault();
      startX = e.clientX;
      startY = e.clientY;
      dragStarted = false;
      moduleIcon.setPointerCapture(e.pointerId);
      
      function onPointerMove(ev) {
          const deltaX = Math.abs(ev.clientX - startX);
          const deltaY = Math.abs(ev.clientY - startY);
          if (!dragStarted && (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD)) {
              dragStarted = true;
              if (moduleIcon.moduleData) {
                  ghost = document.createElement('div');
                  ghost.textContent = moduleName;
                  ghost.style.position = 'fixed';
                  ghost.style.width = '42px';
                  ghost.style.height = '42px';
                  ghost.style.display = 'flex';
                  ghost.style.alignItems = 'center';
                  ghost.style.justifyContent = 'center';
                  ghost.style.fontFamily = "'Roboto Mono', monospace";
                  ghost.style.fontSize = '10px';
                  ghost.style.background = '#ffa800';
                  ghost.style.color = '#151525';
                  ghost.style.borderRadius = '4px';
                  ghost.style.boxShadow = '0 2px 6px rgba(0,0,0,0.5)';
                  ghost.style.zIndex = '9999';
                  ghost.style.pointerEvents = 'none';
                  ghost.style.opacity = '0.5';
                  document.body.appendChild(ghost);
              }
          }
          if (dragStarted && ghost) {
              ghost.style.left = (ev.clientX - 21) + 'px';
              ghost.style.top = (ev.clientY - 21) + 'px';
          }
      }
      
      function onPointerUp(ev) {
          moduleIcon.releasePointerCapture(e.pointerId);
          document.removeEventListener('pointermove', onPointerMove);
          document.removeEventListener('pointerup', onPointerUp);
          if (ghost && ghost.parentNode) {
              ghost.parentNode.removeChild(ghost);
          }
          if (dragStarted && moduleIcon.moduleData) {
              let noteTarget = null;
              if (ev.composedPath) {
                  const path = ev.composedPath();
                  for (const el of path) {
                      if (el instanceof HTMLElement && el.hasAttribute('data-note-id')) {
                          noteTarget = el;
                          break;
                      }
                  }
              }
              if (!noteTarget) {
                  const dropElem = document.elementFromPoint(ev.clientX, ev.clientY);
                  if (dropElem) noteTarget = dropElem.closest('[data-note-id]');
              }
              if (noteTarget) {
                  const noteId = noteTarget.getAttribute('data-note-id');
                  if (noteId) {
                      const targetNote = myModule.getNoteById(Number(noteId));
                      if (targetNote) {
                          importModuleAtTarget(targetNote, moduleIcon.moduleData);
                      } else {
                          console.warn("No matching module note found for id:", noteId);
                      }
                  }
              }
          }
          ghost = null;
      }
      
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    });

    return moduleIcon;
  }

  function createSectionSeparator() {
    const separator = document.createElement('div');
    separator.style.width = '100%';
    separator.style.borderTop = '1px dotted #ffa800';
    separator.style.opacity = '0.3';
    separator.style.marginTop = '0px';
    separator.style.marginBottom = '4px';
    return separator;
  }

  const categories = ['intervals', 'chords', 'melodies'];
  categories.forEach((category, index) => {
    const sectionContainer = document.createElement('div');
    sectionContainer.style.display = 'flex';
    sectionContainer.style.flexWrap = 'wrap';
    sectionContainer.style.alignItems = 'center';
    sectionContainer.style.gap = '4px';

    const labelIcon = createLabelIcon(category);
    labelIcon.addEventListener('click', () => handleFileUpload(category, sectionContainer));

    sectionContainer.appendChild(labelIcon);

    fetch('modules/' + category + '/index.json')
        .then(response => {
            if (!response.ok) throw new Error('Network response not ok for category ' + category);
            return response.json();
        })
        .then(fileList => {
            fileList.forEach(filename => {
                const icon = createModuleIcon(category, filename);
                sectionContainer.appendChild(icon);
            });
        })
        .catch(err => console.error("Error fetching category index for", category, err));

    iconsContainer.appendChild(sectionContainer);
    const breaker = document.createElement('div');
    breaker.style.flexBasis = '100%';
    breaker.style.height = '0';
    iconsContainer.appendChild(breaker);
    if (index < categories.length - 1) {
        iconsContainer.appendChild(createSectionSeparator());
    }
  });
});