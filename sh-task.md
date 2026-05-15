# Prompt para definir la aplicación

Sí. Te conviene arrancar con un prompt que obligue al modelo a pensar como si estuviera diseñando un producto real, no solo tirando features.

Usa este:

```text
Quiero diseñar una aplicación de terminal para Linux, inspirada en Trello y Asana, enfocada en gestión personal o de equipo liviano.

La app debe permitir:
- Crear, editar, listar y eliminar tareas
- Asignar a cada tarea un estado/status
- Mover tareas entre estados de forma simple
- Ver detalle completo de cada tarea
- Asociar sesiones de trabajo tipo Pomodoro a cada tarea
- Registrar historial o progreso de trabajo por tarea

Quiero que me ayudes a definir el producto y la arquitectura inicial.

Contexto del producto:
- Debe correr en terminal Linux
- La experiencia tiene que ser rápida, clara y usable solo con teclado
- Quiero algo serio, práctico y escalable, no un juguete
- Puede comenzar como app local para un solo usuario, pero quiero dejar abierta la posibilidad de crecer después
- Me interesa una UI TUI elegante y eficiente

Necesito que estructures la respuesta en estas secciones:

1. Visión del producto
- Qué problema resuelve
- Perfil de usuario ideal
- Casos de uso principales
- Diferencias frente a Trello/Asana por estar en terminal

2. Alcance del MVP
- Qué funcionalidades mínimas debería tener la primera versión
- Qué dejar fuera para no sobrecargar el MVP
- Flujo principal de uso de punta a punta

3. Modelo de dominio
Define las entidades principales y sus relaciones, por ejemplo:
- Task
- Status
- Board o Workflow
- PomodoroSession
- Tag, Priority, Note, History, etc.

Para cada entidad, explica:
- propósito
- campos clave
- reglas de negocio

4. Diseño funcional
Propón cómo debería funcionar la app en terminal:
- pantallas o vistas
- navegación por teclado
- atajos útiles
- cómo mover tareas entre estados
- cómo abrir detalle de tarea
- cómo iniciar/pausar/finalizar pomodoros
- cómo mostrar timers activos

5. Persistencia
Compara opciones para guardar datos:
- archivos JSON/YAML
- SQLite
- otra alternativa si aplica

Quiero una recomendación concreta para el MVP y una explicación de trade-offs.

6. Arquitectura técnica
Sugiere una arquitectura inicial:
- lenguaje recomendado
- librerías o frameworks TUI recomendados
- estructura de carpetas
- separación entre dominio, aplicación, persistencia y UI
- estrategia de configuración
- estrategia de logs y manejo de errores

7. Roadmap
Divide la evolución en fases:
- MVP
- v1
- v2

Incluye features como:
- etiquetas
- prioridades
- búsqueda y filtros
- estadísticas de pomodoro
- exportación/importación
- sincronización futura

8. Riesgos y decisiones
- decisiones técnicas que debo tomar temprano
- riesgos de UX en apps de terminal
- errores comunes al construir una TUI de productividad

9. Recomendación final
Cierra con:
- stack recomendado
- arquitectura recomendada
- orden de implementación
- una propuesta concreta de MVP realizable

Importante:
- No quiero una respuesta genérica
- Quiero decisiones concretas y justificadas
- Si propones varias opciones, termina eligiendo una
- Prioriza simplicidad, mantenibilidad y buena experiencia en terminal
```

Si quieres, también te dejo una versión todavía más ejecutable, orientada a que la IA te proponga directamente el stack y el plan de implementación:

```text
Actúa como Product Designer + Software Architect senior.

Ayúdame a definir una aplicación TUI para Linux de gestión de tareas, inspirada en Trello/Asana, con soporte de pomodoro por tarea.

Objetivo:
Diseñar un MVP serio, usable y mantenible, pensado para terminal, con posibilidad de crecer.

La app debe permitir:
- gestionar tareas
- asignar estados/status
- mover tareas entre estados
- ver detalle de cada tarea
- registrar sesiones pomodoro por tarea

Quiero que tomes decisiones concretas sobre:
- alcance del MVP
- modelo de datos
- UX de terminal
- persistencia
- stack técnico
- arquitectura
- roadmap

Restricciones:
- Linux
- keyboard-first
- rápida y minimalista
- pensada primero para uso local
- fácil de mantener
- evitar sobreingeniería

Quiero que me entregues:
- propuesta de producto
- entidades y reglas de negocio
- diseño de interacción TUI
- recomendación de stack exacto
- arquitectura base
- estructura de proyecto
- roadmap por fases
- riesgos principales
- propuesta final de MVP

Termina con:
1. “Stack recomendado”
2. “MVP exacto”
3. “Primeros 10 pasos de implementación”
```

Si quieres, en el próximo mensaje te lo adapto a un stack concreto, por ejemplo:
- `Go + Bubble Tea`
- `Python + Textual`
- `Rust + Ratatui`

Yo te recomendaría bastante `Go + Bubble Tea` o `Python + Textual` para empezar rápido.
