/* eslint-disable no-shadow */
/* eslint-disable prefer-destructuring */
/* eslint-disable no-param-reassign */
/* eslint-disable no-restricted-syntax */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const transform = (data) => {
  const cleanUp = (data) => {
    const clean = text => text.toString()
      .replace(/\r\n|\r|\n/g, ' ')
      .replace(/&amp;nbsp;/g, ' ')
      .replace(/&amp;#160/g, ' ')
      .replace(/\u00A0/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/"\s{1,}/g, '"')
      .replace(/\s{1,}"/g, '"')
      .replace(/^ +| +$|( )+/g, ' ')
    // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F]/g, '')
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ' ');
    data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach(header => row[header].forEach((el) => {
      el.text = clean(el.text);
    }))));
    return data;
  };
  for (const { group } of data) {
    for (const row of group) {
      if (row.Program_Director_Full_Name) {
        let fullName = '';
        row.Program_Director_Full_Name.forEach((item) => {
          if (item.text.includes(',')) {
            item.text = item.text.split(',')[0];
            if (item.text.includes('.')) {
              fullName = item.text.split('.')[1];
            } else {
              fullName = item.text;
            }
          }

          if (item.text.includes('.')) {
            fullName = item.text.split('.');
            if (fullName.includes('')) {
              fullName = '';
            } else {
              fullName = fullName[1];
            }
          }

          if (item.text) {
            fullName = item.text.trim();
          }
        });

        row.Program_Director_Full_Name = [
          { text: fullName },
        ];
        row.Program_Director_First_Name = [
          { text: fullName.split(' ')[0] },
        ];
        let middleName = '';
        const fullName1 = fullName.split(' ');
        const lastName = fullName1[fullName1.length - 1];
        if (fullName1.length === 3) {
          middleName = fullName1[1];
        }
        if (fullName1.length === 2) {
          middleName = '';
        }

        row.Program_Director_Middle_Name = [
          { text: middleName },
        ];

        row.Program_Director_Last_Name = [
          { text: lastName },
        ];
      }

      if (row.Program_Coordinator_Full_Name) {
        row.Program_Coordinator_Full_Name.forEach((item) => {
          if (item.text.includes(',')) {
            item.text = item.text.split(',')[0].trim();
            if (item.text.includes('.')) {
              item.text = item.text.split('.')[1].trim();
            }
          }

          if (item.text.includes('.')) {
            item.text = item.text.split('.')[1];
          }

          if (item.text) {
            item.text = item.text.trim();
          }
        });
      }

      if (row.Program_Coordinator_First_Name) {
        row.Program_Coordinator_First_Name.forEach((item) => {
          if (item.text.includes(',')) {
            item.text = item.text.split(',')[0].trim();
            if (item.text.includes('.')) {
              item.text = item.text.split('.')[1].trim();
              item.text = item.text.split(' ')[0];
            } else {
              item.text = item.text.split(' ')[0];
            }
          }

          if (item.text.includes('.')) {
            item.text = item.text.split('.')[1];
            item.text = item.text.split(' ')[1];
          }

          if (item.text) {
            item.text = item.text.trim();
            item.text = item.text.split(' ')[0];
          }
        });
      }

      if (row.Program_Coordinator_Last_Name) {
        row.Program_Coordinator_Last_Name.forEach((item) => {
          if (item.text.includes(',')) {
            item.text = item.text.split(',')[0].trim();
            if (item.text.includes('.')) {
              item.text = item.text.split('.')[1].trim();
              const split1 = item.text.split(' ');
              item.text = split1[split1.length - 1];
            } else {
              const split1 = item.text.split(' ');
              item.text = split1[split1.length - 1];
            }
          }

          if (item.text.includes('.')) {
            item.text = item.text.split('.')[1];
            const split1 = item.text.split(' ');
            item.text = split1[split1.length - 1];
          }

          if (item.text) {
            item.text = item.text.trim();
            const split1 = item.text.split(' ');
            item.text = split1[split1.length - 1];
          }
        });
      }

      if (row.Program_Coordinator_Middle_Name) {
        console.log('row.Program_Coordinator_Middle_Name', row.Program_Coordinator_Middle_Name);
        row.Program_Coordinator_Middle_Name.forEach((item) => {
          if (item.text.includes(',')) {
            console.log('item.text', item.text);
            item.text = item.text.split(',')[0].trim();
            console.log('item.text11', item.text);
            if (item.text.includes('.')) {
              item.text = item.text.split('.')[1].trim();
              const split1 = item.text.split(' ');
              console.log('check...split***', split1);
              if (split1.length === 3) {
                console.log('hi');
                item.text = split1[1];
              }
              if (split1.length === 4) {
                console.log('hi2');
                item.text = split1[1];
              }
              if (split1.length === 5) {
                console.log('hi2');
                item.text = split1[1];
              }
              if (split1.length === 2) {
                console.log('hi2');
                item.text = '';
              }
            } else {
              const split1 = item.text.split(' ');
              console.log('split1***', split1);
              if (split1.length === 3) {
                item.text = split1[1];
              }
              if (split1.length === 4) {
                console.log('hi2');
                item.text = split1[1];
              }
              if (split1.length === 5) {
                console.log('hi2');
                item.text = split1[1];
              }
              if (split1.length === 2) {
                item.text = '';
              }
            }
          }

          if (item.text.includes('.')) {
            console.log('hionlydot');
            item.text = item.text.split('.')[1].trim();
            console.log('fullNameLLL', item.text);
            const split1 = item.text.split(' ');
            if (split1.length === 3) {
              item.text = split1[1];
              console.log('bye', item.text);
            }
            if (split1.length === 4) {
              console.log('hi2');
              item.text = split1[1];
            }
            if (split1.length === 5) {
              console.log('hi2');
              item.text = split1[1];
            }
            if (split1.length === 2) {
              console.log('hiiiiii', item.text);
              item.text = '';
            }
          }

          if (item.text) {
            item.text = item.text.trim();
            const split1 = item.text.split(' ');
            if (split1.length === 3) {
              item.text = split1[1];
            }
            if (split1.length === 4) {
              console.log('hi2');
              item.text = split1[1];
            }
            if (split1.length === 5) {
              console.log('hi2');
              item.text = split1[1];
            }
            if (split1.length === 2) {
              item.text = '';
            }
          }
        });
      }

      if (row.Program_Director_Credentials) {
        row.Program_Director_Credentials.forEach((item) => {
          if (item.text.includes(',')) {
            item.text = item.text.split(',')[1].trim();
          }
        });
      }

      if (row.Program_Coordinator_Prefix) {
        row.Program_Coordinator_Prefix.forEach((item) => {
          if (item.text.includes('.')) {
            const split1 = item.text.split('.')[0];
            if (split1.includes('Mrs') || split1.includes('Ms')) {
              item.text = split1;
            } else {
              item.text = '';
            }
          } else {
            item.text = '';
          }
        });
      }

      if (row.Program_Coordinator_Credentials) {
        row.Program_Coordinator_Credentials.forEach((item) => {
          if (item.text.includes(',')) {
            item.text = item.text.split(',')[1].trim();
          } else {
            item.text = '';
          }
        });
      }

      if (row.Participating_Site_Required_Rotation) {
        row.Participating_Site_Required_Rotation.forEach((item) => {
          if (item.text === 'Yes') {
            item.text = 'true';
          } else {
            item.text = 'false';
          }
        });
      }

      if (row.Sponsoring_Institution_Name) {
        row.Sponsoring_Institution_Name.forEach((item) => {
          if (item.text.includes(']')) {
            item.text = item.text.replace(']', '').trim();
            if (item.text.includes('[')) {
              item.text = item.text.replace('[', '').trim();
            }
          }
        });
      }
    }
  }
  return cleanUp(data);
};
module.exports = { transform };
//
