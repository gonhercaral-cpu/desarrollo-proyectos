export const NAME_CORRECTIONS = {
  // Nombres con acento
  jose: "José",
  maria: "María",
  angel: "Ángel",
  jesus: "Jesús",
  sofia: "Sofía",
  andres: "Andrés",
  martin: "Martín",
  nicolas: "Nicolás",
  sebastian: "Sebastián",
  adrian: "Adrián",
  raul: "Raúl",
  cesar: "César",
  oscar: "Óscar",
  victor: "Víctor",
  hector: "Héctor",
  alvaro: "Álvaro",
  dario: "Darío",
  isaias: "Isaías",
  joaquin: "Joaquín",
  ruben: "Rubén",
  emmanuel: "Emmanuel",
  emanuel: "Emanuel",

  // Apellidos correctos sin acento escrito
  gonzalez: "González",
  hernandez: "Hernández",
  lopez: "López",
  martinez: "Martínez",
  sanchez: "Sánchez",
  ramirez: "Ramírez",
  perez: "Pérez",
  jimenez: "Jiménez",
  rodriguez: "Rodríguez",
  diaz: "Díaz",
  vazquez: "Vázquez",
  suarez: "Suárez",
  gutierrez: "Gutiérrez",
  rios: "Ríos",
  cortes: "Cortés",
  ibañez: "Ibáñez",
  nuñez: "Núñez",
  benitez: "Benítez",
  chavez: "Chávez",
  dominguez: "Domínguez",
  marquez: "Márquez",

  // Errores comunes de S/Z
  gonzales: "González",
  hernandes: "Hernández",
  martines: "Martínez",
  rodrigues: "Rodríguez",
  sanches: "Sánchez",
  ramires: "Ramírez",
  jimenezs: "Jiménez",
  jimines: "Jiménez",
  gutierres: "Gutiérrez",
  vasques: "Vázquez",
  suáres: "Suárez",
  suares: "Suárez",
  dias: "Díaz",
  lopezs: "López",
  lopes: "López",
  pires: "Pérez",
  peres: "Pérez",
  chavés: "Chávez",
  chaves: "Chávez",
  marques: "Márquez",
  domingues: "Domínguez",
  benites: "Benítez",
  nunes: "Núñez",
  cortesz: "Cortés",

  // Otros apellidos frecuentes que conviene normalizar
  aguilar: "Aguilar",
  flores: "Flores",
  morales: "Morales",
  torres: "Torres",
  vargas: "Vargas",
  castillo: "Castillo",
  cruz: "Cruz",
  ortiz: "Ortiz",
  reyes: "Reyes",
  medina: "Medina",
  mendoza: "Mendoza",
  castro: "Castro",
  romero: "Romero",
  guerrero: "Guerrero",
  ramos: "Ramos",
  ruiz: "Ruiz",
  rivera: "Rivera",
  navarro: "Navarro",
  campos: "Campos",
  soto: "Soto",
  salazar: "Salazar",
  valdez: "Valdez",
  valdes: "Valdez",
  ibarra: "Ibarra",
  estrada: "Estrada",
  carrillo: "Carrillo",
  cervantes: "Cervantes",
  bautista: "Bautista",
  miranda: "Miranda",
  montes: "Montes"
};

const LOWERCASE_PARTICLES = new Set([
  "de",
  "del",
  "la",
  "las",
  "los",
  "y"
]);

export function cleanNameSpaces(value = "") {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeNameKey(value = "") {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function capitalizeWord(word, index) {
  const key = normalizeNameKey(word);

  if (index !== 0 && LOWERCASE_PARTICLES.has(key)) {
    return key;
  }

  if (NAME_CORRECTIONS[key]) {
    return NAME_CORRECTIONS[key];
  }

  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function suggestNameCorrection(fullName = "") {
  const cleaned = cleanNameSpaces(fullName);

  if (!cleaned) {
    return {
      hasSuggestion: false,
      original: "",
      suggested: ""
    };
  }

  const suggested = cleaned
    .split(" ")
    .map((word, index) => capitalizeWord(word, index))
    .join(" ");

  return {
    hasSuggestion: cleaned !== suggested,
    original: cleaned,
    suggested
  };
}

export function prepareStudentNameReview(students = []) {
  return students.map((student) => {
    const correction = suggestNameCorrection(student.fullName || "");

    return {
      ...student,
      originalName: correction.original,
      finalName: correction.original,
      suggestedName: correction.suggested,
      hasSuggestion: correction.hasSuggestion,
      correctionAccepted: false
    };
  });
}

export function acceptStudentSuggestion(student) {
  return {
    ...student,
    finalName: student.suggestedName,
    correctionAccepted: true
  };
}

export function keepStudentOriginal(student) {
  return {
    ...student,
    finalName: student.originalName,
    correctionAccepted: false
  };
}
